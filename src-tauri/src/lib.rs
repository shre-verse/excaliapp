mod menu;
mod security;

use notify::{Event, EventKind, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::fs;
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use fs2::FileExt;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExcalidrawFile {
    pub name: String,
    pub path: String,
    pub modified: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileContent {
    pub content: String,
    pub content_hash: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileTreeNode {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub modified: bool,
    pub children: Option<Vec<FileTreeNode>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Preferences {
    pub last_directory: Option<String>,
    pub recent_directories: Vec<String>,
    pub theme: String,
    pub sidebar_visible: bool,
    #[serde(default = "default_true")]
    pub show_decorations: bool,
    #[serde(default)]
    pub workspace_access: HashMap<String, String>,
}

fn default_true() -> bool {
    true
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            last_directory: None,
            recent_directories: Vec::new(),
            theme: "system".to_string(),
            sidebar_visible: true,
            show_decorations: true,
            workspace_access: HashMap::new(),
        }
    }
}

pub struct AppState {
    pub current_directory: Mutex<Option<PathBuf>>,
    pub modified_files: Mutex<Vec<String>>,
    pub watcher: Mutex<Option<notify::RecommendedWatcher>>,
}

#[tauri::command]
async fn select_directory(app: AppHandle) -> Result<Option<String>, String> {
    use std::sync::mpsc;
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = mpsc::channel();

    app.dialog().file().pick_folder(move |path| {
        let _ = tx.send(path);
    });

    match rx.recv() {
        Ok(Some(path)) => Ok(Some(path.to_string())),
        Ok(None) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn list_excalidraw_files(directory: String) -> Result<Vec<ExcalidrawFile>, String> {
    let path = Path::new(&directory);

    if !path.exists() {
        return Err("Directory does not exist".to_string());
    }

    let mut files = Vec::new();
    collect_excalidraw_files_recursive(path, &mut files)?;
    files.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(files)
}

#[tauri::command]
async fn get_file_tree(directory: String) -> Result<Vec<FileTreeNode>, String> {
    let path = Path::new(&directory);

    if !path.exists() {
        return Err("Directory does not exist".to_string());
    }

    let mut tree = Vec::new();
    build_file_tree(path, &mut tree)?;
    tree.sort_by(|a, b| match (a.is_directory, b.is_directory) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.cmp(&b.name),
    });
    Ok(tree)
}

fn collect_excalidraw_files_recursive(
    dir: &Path,
    files: &mut Vec<ExcalidrawFile>,
) -> Result<(), String> {
    match fs::read_dir(dir) {
        Ok(entries) => {
            for entry in entries.flatten() {
                let path = entry.path();
                if is_hidden_path(&path) {
                    continue;
                }

                if path.is_file() {
                    if let Some(extension) = path.extension() {
                        if extension == "excalidraw" {
                            if let Some(file_name) = path.file_name() {
                                files.push(ExcalidrawFile {
                                    name: file_name.to_string_lossy().to_string(),
                                    path: path.to_string_lossy().to_string(),
                                    modified: false,
                                });
                            }
                        }
                    }
                } else if path.is_dir() {
                    collect_excalidraw_files_recursive(&path, files)?;
                }
            }
        }
        Err(e) => return Err(e.to_string()),
    }
    Ok(())
}

fn is_hidden_path(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with('.'))
}

fn build_file_tree(dir: &Path, tree: &mut Vec<FileTreeNode>) -> Result<(), String> {
    match fs::read_dir(dir) {
        Ok(entries) => {
            for entry in entries.flatten() {
                let path = entry.path();
                if is_hidden_path(&path) {
                    continue;
                }

                let name = path
                    .file_name()
                    .ok_or("Invalid file name")?
                    .to_string_lossy()
                    .to_string();

                if path.is_dir() {
                    let mut children = Vec::new();
                    build_file_tree(&path, &mut children)?;

                    children.sort_by(|a, b| match (a.is_directory, b.is_directory) {
                        (true, false) => std::cmp::Ordering::Less,
                        (false, true) => std::cmp::Ordering::Greater,
                        _ => a.name.cmp(&b.name),
                    });

                    tree.push(FileTreeNode {
                        name,
                        path: path.to_string_lossy().to_string(),
                        is_directory: true,
                        modified: false,
                        children: Some(children),
                    });
                } else if path.is_file() {
                    if let Some(extension) = path.extension() {
                        if extension == "excalidraw" {
                            tree.push(FileTreeNode {
                                name,
                                path: path.to_string_lossy().to_string(),
                                is_directory: false,
                                modified: false,
                                children: None,
                            });
                        }
                    }
                }
            }
        }
        Err(e) => return Err(e.to_string()),
    }
    Ok(())
}

#[tauri::command]
async fn read_file(file_path: String) -> Result<String, String> {
    Ok(read_excalidraw_file_with_hash(&file_path)?.content)
}

#[tauri::command]
async fn read_file_with_hash(file_path: String) -> Result<FileContent, String> {
    read_excalidraw_file_with_hash(&file_path)
}

#[tauri::command]
async fn hash_file_content(file_path: String) -> Result<String, String> {
    let path = Path::new(&file_path);
    let validated_path = security::validate_path(path, None)?;

    security::validate_excalidraw_file(&validated_path)?;
    let content = fs::read_to_string(&validated_path).map_err(|e| e.to_string())?;

    Ok(blake3_hash(&content))
}

fn read_excalidraw_file_with_hash(file_path: &str) -> Result<FileContent, String> {
    let path = Path::new(file_path);
    let validated_path = security::validate_path(path, None)?;

    security::validate_excalidraw_file(&validated_path)?;
    let content = fs::read_to_string(&validated_path).map_err(|e| e.to_string())?;

    security::validate_excalidraw_content(&content)?;

    Ok(FileContent {
        content_hash: blake3_hash(&content),
        content,
    })
}

fn blake3_hash(content: &str) -> String {
    blake3::hash(content.as_bytes()).to_hex().to_string()
}

fn write_if_hash_matches(
    path: &Path,
    content: &str,
    expected_hash: &str,
) -> Result<String, String> {
    let mut file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    file.lock_exclusive().map_err(|e| e.to_string())?;

    let mut current_content = String::new();
    file.read_to_string(&mut current_content)
        .map_err(|e| e.to_string())?;
    let current_hash = blake3_hash(&current_content);
    if current_hash != expected_hash {
        return Err(format!("FILE_CONFLICT:{current_hash}"));
    }

    file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    file.set_len(0).map_err(|e| e.to_string())?;
    file.write_all(content.as_bytes())
        .map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    file.unlock().map_err(|e| e.to_string())?;
    Ok(blake3_hash(content))
}

fn create_new_excalidraw_file(path: &Path, content: &str) -> Result<(), String> {
    security::validate_excalidraw_file(path)?;
    security::validate_excalidraw_content(content)?;

    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    file.write_all(content.as_bytes())
        .map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())
}

fn should_emit_change_for_path(path: &Path) -> bool {
    path.extension()
        .is_some_and(|extension| extension == "excalidraw")
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum PreferencesRollbackAction {
    Restore(serde_json::Value),
    Delete,
}

fn preferences_rollback_action(
    previous_value: Option<serde_json::Value>,
) -> PreferencesRollbackAction {
    match previous_value {
        Some(value) => PreferencesRollbackAction::Restore(value),
        None => PreferencesRollbackAction::Delete,
    }
}

#[tauri::command]
async fn save_file(
    file_path: String,
    content: String,
    expected_hash: String,
) -> Result<String, String> {
    // Validate path to prevent traversal attacks
    let path = Path::new(&file_path);
    let validated_path = security::validate_path(path, None)?;

    // Validate it's an excalidraw file
    security::validate_excalidraw_file(&validated_path)?;

    // Validate the content before saving
    security::validate_excalidraw_content(&content)?;

    write_if_hash_matches(&validated_path, &content, &expected_hash)
}

#[tauri::command]
async fn save_file_as(app: AppHandle, content: String) -> Result<Option<String>, String> {
    use std::sync::mpsc;
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = mpsc::channel();

    app.dialog()
        .file()
        .add_filter("Excalidraw", &["excalidraw"])
        .set_title("Save As")
        .save_file(move |path| {
            let _ = tx.send(path);
        });

    match rx.recv() {
        Ok(Some(path)) => {
            let path_str = path.to_string();
            match create_new_excalidraw_file(Path::new(&path_str), &content) {
                Ok(_) => Ok(Some(path_str)),
                Err(e) => Err(e.to_string()),
            }
        }
        Ok(None) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Creates a new folder in the specified directory
#[tauri::command]
async fn create_new_folder(directory: String, folder_name: String) -> Result<String, String> {
    // Validate and canonicalize the directory path
    let dir_path = Path::new(&directory);
    let validated_dir = security::validate_path(dir_path, None)?;

    if !validated_dir.is_dir() {
        return Err(format!("Path is not a directory: {}", directory));
    }

    // Safely join the folder name to the directory
    let mut path = security::safe_path_join(&validated_dir, &folder_name)?;

    // Check if folder already exists and find unique name
    if path.exists() {
        let mut counter = 1;
        let base_name = folder_name.trim_end_matches('/').to_string();

        loop {
            let new_name = format!("{}-{}", base_name, counter);
            path = security::safe_path_join(&validated_dir, &new_name)?;

            if !path.exists() {
                break;
            }
            counter += 1;

            if counter > 100 {
                return Err("Could not find unique folder name".to_string());
            }
        }
    }

    match fs::create_dir(&path) {
        Ok(_) => {
            // Verify the folder was created
            if !path.exists() {
                eprintln!("[create_new_folder] Folder doesn't exist after creation!");
                return Err("Folder creation verification failed".to_string());
            }

            // Verify it's actually a directory
            if !path.is_dir() {
                eprintln!("[create_new_folder] Path exists but is not a directory!");
                return Err("Created path is not a directory".to_string());
            }

            Ok(path.to_string_lossy().to_string())
        }
        Err(e) => {
            eprintln!("[create_new_folder] Failed to create folder: {}", e);
            Err(format!("Failed to create folder: {}", e))
        }
    }
}

#[tauri::command]
async fn create_new_file(directory: String, file_name: String) -> Result<String, String> {
    // Validate and canonicalize the directory path
    let dir_path = Path::new(&directory);
    let validated_dir = security::validate_path(dir_path, None)?;

    if !validated_dir.is_dir() {
        return Err(format!("Path is not a directory: {}", directory));
    }

    let final_file_name = if file_name.ends_with(".excalidraw") {
        file_name
    } else {
        format!("{}.excalidraw", file_name)
    };

    // Safely join the filename to the directory
    let mut path = security::safe_path_join(&validated_dir, &final_file_name)?;

    // Check if file already exists and suggest alternative
    if path.exists() {
        // Find a unique name by appending numbers
        let mut counter = 1;

        // Get the base name without extension
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .ok_or("Invalid file name")?
            .to_string(); // Convert to owned String

        // Handle the .excalidraw extension properly
        let base_stem = if stem.ends_with(".excalidraw") {
            stem.trim_end_matches(".excalidraw").to_string()
        } else {
            stem
        };

        loop {
            let new_name = format!("{}-{}.excalidraw", base_stem, counter);
            path = validated_dir.join(&new_name);

            if !path.exists() {
                break;
            }
            counter += 1;

            if counter > 100 {
                return Err("Could not find unique file name".to_string());
            }
        }
    }

    let default_content = serde_json::json!({
        "type": "excalidraw",
        "version": 2,
        "source": "ExcaliApp",
        "elements": [],
        "appState": {
            "gridSize": null,
            "viewBackgroundColor": "#ffffff"
        },
        "files": {}
    });

    let content_str = serde_json::to_string_pretty(&default_content)
        .map_err(|e| format!("Failed to serialize content: {}", e))?;

    fs::write(&path, &content_str).map_err(|e| format!("Failed to create file: {}", e))?;

    if !path.exists() {
        return Err("File creation verification failed".to_string());
    }

    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
async fn get_preferences(app: AppHandle) -> Result<Preferences, String> {
    use tauri_plugin_store::StoreExt;

    let store = app.store("preferences.json").map_err(|e| e.to_string())?;

    let prefs = if let Some(value) = store.get("preferences") {
        // Try to deserialize, but ensure all fields have values
        match serde_json::from_value::<Preferences>(value.clone()) {
            Ok(mut p) => {
                // Ensure recent_directories is never None/null
                if p.recent_directories.is_empty() {
                    p.recent_directories = Vec::new();
                }
                p
            }
            Err(_) => Preferences::default(),
        }
    } else {
        Preferences::default()
    };

    Ok(prefs)
}

#[tauri::command]
async fn rename_file(old_path: String, new_name: String) -> Result<String, String> {
    // Validate the old path
    let old_path = Path::new(&old_path);
    let validated_old = security::validate_path(old_path, None)?;

    if !validated_old.exists() {
        return Err("File does not exist".to_string());
    }

    security::validate_excalidraw_file(&validated_old)?;

    let parent = validated_old.parent().ok_or("Invalid file path")?;

    // Safely create the new path
    let new_path = security::safe_path_join(parent, &new_name)?;

    // Ensure the new path also has .excalidraw extension
    let new_path = if new_path.extension() != Some(std::ffi::OsStr::new("excalidraw")) {
        new_path.with_extension("excalidraw")
    } else {
        new_path
    };

    if new_path.exists() && new_path != old_path {
        return Err("A file with that name already exists".to_string());
    }

    fs::rename(&validated_old, &new_path).map_err(|e| format!("Failed to rename file: {}", e))?;

    Ok(new_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn rename_folder(old_path: String, new_name: String) -> Result<String, String> {
    let old_path = Path::new(&old_path);
    let validated_old = security::validate_path(old_path, None)?;

    if !validated_old.exists() {
        return Err("Folder does not exist".to_string());
    }

    if !validated_old.is_dir() {
        return Err("Path is not a folder".to_string());
    }

    let parent = validated_old.parent().ok_or("Invalid folder path")?;
    let new_path = security::safe_path_join(parent, &new_name)?;

    if new_path.exists() && new_path != validated_old {
        return Err("A folder or file with that name already exists".to_string());
    }

    fs::rename(&validated_old, &new_path).map_err(|e| format!("Failed to rename folder: {}", e))?;

    Ok(new_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn delete_file(file_path: String) -> Result<(), String> {
    // Validate path to prevent traversal attacks
    let path = Path::new(&file_path);
    let validated_path = security::validate_path(path, None)?;

    if !validated_path.exists() {
        return Err("File does not exist".to_string());
    }

    // Ensure we're only deleting excalidraw files
    security::validate_excalidraw_file(&validated_path)?;

    fs::remove_file(&validated_path).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
async fn delete_folder(folder_path: String) -> Result<(), String> {
    let path = Path::new(&folder_path);
    let validated_path = security::validate_path(path, None)?;

    if !validated_path.exists() {
        return Err("Folder does not exist".to_string());
    }

    if !validated_path.is_dir() {
        return Err("Path is not a folder".to_string());
    }

    fs::remove_dir_all(&validated_path).map_err(|e| format!("Failed to delete folder: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn save_preferences(app: AppHandle, preferences: Preferences) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;

    let store = app.store("preferences.json").map_err(|e| e.to_string())?;
    let previous_preferences = store.get("preferences");
    let preferences_value = serde_json::to_value(&preferences).map_err(|e| e.to_string())?;

    store.set("preferences", preferences_value);
    if let Err(error) = store.save() {
        match preferences_rollback_action(previous_preferences) {
            PreferencesRollbackAction::Restore(previous_value) => {
                store.set("preferences", previous_value);
            }
            PreferencesRollbackAction::Delete => {
                store.delete("preferences");
            }
        }

        return Err(error.to_string());
    }

    // Update recent directories menu
    let _ = menu::update_recent_directories_menu(&app, preferences.recent_directories.clone());

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preferences_rollback_action_restores_existing_value() {
        let value = serde_json::json!({
            "theme": "dark"
        });

        assert_eq!(
            preferences_rollback_action(Some(value.clone())),
            PreferencesRollbackAction::Restore(value)
        );
    }

    #[test]
    fn preferences_rollback_action_deletes_missing_value() {
        assert_eq!(preferences_rollback_action(None), PreferencesRollbackAction::Delete);
    }
}

#[tauri::command]
async fn set_menu_visible(app: AppHandle, visible: bool) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("No main window")?;
    if visible {
        let menu = menu::create_menu(&app).map_err(|e| e.to_string())?;
        window.set_menu(menu).map_err(|e| e.to_string())?;
    } else {
        window.remove_menu().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn set_decorations(app: AppHandle, visible: bool) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("No main window")?;
    window.set_decorations(visible).map_err(|e| e.to_string())?;
    if visible {
        let menu = menu::create_menu(&app).map_err(|e| e.to_string())?;
        window.set_menu(menu).map_err(|e| e.to_string())?;
    } else {
        window.remove_menu().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn force_close_app(app: AppHandle) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

#[tauri::command]
async fn watch_directory(
    app: AppHandle,
    directory: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let path = PathBuf::from(&directory);

    {
        let mut current_dir = state.current_directory.lock().unwrap();
        *current_dir = Some(path.clone());
    }

    let app_handle = app.clone();
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<Event>| {
        match result {
            Ok(Event {
                kind: EventKind::Create(_) | EventKind::Remove(_) | EventKind::Modify(_),
                paths,
                ..
            }) => {
                for changed_path in paths {
                    if should_emit_change_for_path(&changed_path) {
                        let _ = app_handle.emit("file-system-change", &changed_path);
                    }
                }
            }
            Err(error) => eprintln!("Watch error: {error:?}"),
            _ => {}
        }
    })
    .map_err(|e| e.to_string())?;

    watcher
        .watch(&path, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    *state.watcher.lock().unwrap() = Some(watcher);

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            app.manage(AppState {
                current_directory: Mutex::new(None),
                modified_files: Mutex::new(Vec::new()),
                watcher: Mutex::new(None),
            });

            // Create and set up the menu
            let menu = menu::create_menu(app.handle())?;
            app.set_menu(menu)?;
            menu::setup_menu_event_handler(app.handle());

            // Load preferences and update recent directories menu
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                use tauri_plugin_store::StoreExt;
                if let Ok(store) = app_handle.store("preferences.json") {
                    if let Some(value) = store.get("preferences") {
                        if let Ok(prefs) = serde_json::from_value::<Preferences>(value.clone()) {
                            let _ = menu::update_recent_directories_menu(
                                &app_handle,
                                prefs.recent_directories,
                            );
                        }
                    }
                }
            });

            // Add window close handler
            let window = app.get_webview_window("main").unwrap();
            let window_clone = window.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    // Prevent default close
                    api.prevent_close();

                    // Emit event to frontend to check for unsaved changes
                    let _ = window_clone.emit("check-unsaved-before-close", ());
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            select_directory,
            list_excalidraw_files,
            get_file_tree,
            read_file,
            read_file_with_hash,
            hash_file_content,
            save_file,
            save_file_as,
            create_new_file,
            create_new_folder,
            rename_file,
            rename_folder,
            delete_file,
            delete_folder,
            get_preferences,
            save_preferences,
            watch_directory,
            set_menu_visible,
            set_decorations,
            force_close_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod sync_tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_file() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("excaliapp-{unique}"));
        fs::create_dir_all(&directory).unwrap();
        directory.join("drawing.excalidraw")
    }

    #[test]
    fn rejects_save_when_disk_hash_changed() {
        let path = temp_file();
        fs::write(&path, "newer disk content").unwrap();

        let result = write_if_hash_matches(&path, "local content", "stale-hash");

        assert!(result.unwrap_err().starts_with("FILE_CONFLICT:"));
        assert_eq!(fs::read_to_string(&path).unwrap(), "newer disk content");
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn only_emits_watcher_events_for_excalidraw_files() {
        assert!(should_emit_change_for_path(Path::new("drawing.excalidraw")));
        assert!(!should_emit_change_for_path(Path::new("notes.txt")));
        assert!(!should_emit_change_for_path(Path::new("folder")));
    }

    #[test]
    fn save_as_does_not_overwrite_an_existing_file() {
        let path = temp_file();
        fs::write(&path, "existing").unwrap();

        let result = create_new_excalidraw_file(
            &path,
            r#"{"type":"excalidraw","version":2,"elements":[]}"#,
        );

        assert!(result.is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "existing");
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}
