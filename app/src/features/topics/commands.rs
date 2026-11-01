use tauri::State;

use super::model::{DeleteTopicResult, NewTopicRequest, TopicDetail, TopicSummary};
use super::service;
use crate::blocking::run_blocking;
use crate::error::Result;
use crate::kafka::metadata::is_internal;
use crate::state::AppState;

#[tauri::command]
pub async fn list_topics(state: State<'_, AppState>, cluster_id: String) -> Result<Vec<TopicSummary>> {
    let clients = state.clients(&cluster_id)?;
    run_blocking(move || service::list_topics(&clients)).await
}

#[tauri::command]
pub async fn topic_detail(state: State<'_, AppState>, cluster_id: String, topic: String) -> Result<TopicDetail> {
    let clients = state.clients(&cluster_id)?;
    let configs = service::configs(&clients, &topic).await?;
    let partitions = {
        let (clients, topic) = (clients.clone(), topic.clone());
        run_blocking(move || service::partitions(&clients, &topic)).await?
    };
    Ok(TopicDetail { internal: is_internal(&topic), name: topic, partitions, configs })
}

#[tauri::command]
pub async fn create_topic(state: State<'_, AppState>, cluster_id: String, request: NewTopicRequest) -> Result<()> {
    let clients = state.clients(&cluster_id)?;
    service::create(&clients, &request).await
}

#[tauri::command]
pub async fn delete_topics(
    state: State<'_, AppState>,
    cluster_id: String,
    topics: Vec<String>,
) -> Result<Vec<DeleteTopicResult>> {
    let clients = state.clients(&cluster_id)?;
    service::delete(&clients, &topics).await
}
