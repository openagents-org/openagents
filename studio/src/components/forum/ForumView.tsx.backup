import React, { useState, useEffect, useCallback } from 'react';
import { OpenAgentsService } from '../../services/openAgentsService';
import MarkdownRenderer from '../common/MarkdownRenderer';
import { useForumNotifications } from '../../hooks/useForumNotifications';

interface ForumTopic {
  topic_id: string;
  title: string;
  content: string;
  owner_id: string;
  timestamp: number;
  upvotes: number;
  downvotes: number;
  comment_count: number;
}

interface ForumComment {
  comment_id: string;
  topic_id: string;
  content: string;
  author_id: string;
  timestamp: number;
  upvotes: number;
  downvotes: number;
  parent_comment_id?: string;
  thread_level: number;
  replies?: ForumComment[];
}

interface ForumViewProps {
  onBackClick?: () => void;
  currentTheme: 'light' | 'dark';
  connection?: OpenAgentsService | null;
}

const ForumView: React.FC<ForumViewProps> = ({ 
  onBackClick, 
  currentTheme,
  connection
}) => {
  const [topics, setTopics] = useState<ForumTopic[]>([]);
  const [selectedTopic, setSelectedTopic] = useState<ForumTopic | null>(null);
  const [comments, setComments] = useState<ForumComment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateTopic, setShowCreateTopic] = useState(false);
  const [newTopicTitle, setNewTopicTitle] = useState('');
  const [newTopicContent, setNewTopicContent] = useState('');
  const [newCommentContent, setNewCommentContent] = useState('');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [showTopicPreview, setShowTopicPreview] = useState(false);
  const [showCommentPreview, setShowCommentPreview] = useState(false);

  // Forum notifications (currently for setup, can be used for unread counts later)
  useForumNotifications({
    enabled: !!connection,
    currentUserId: connection?.getAgentId() || '',
  });

  // Load topics
  const loadTopics = useCallback(async () => {
    console.log('ForumView: loadTopics called, connection:', connection);
    console.log('ForumView: connection type:', typeof connection);
    console.log('ForumView: connection methods:', connection ? Object.getOwnPropertyNames(connection) : 'no connection');
    
    if (!connection) {
      console.log('ForumView: No connection available');
      setError('Agent is not connected to network');
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      
      const response = await connection.sendEvent({
        event_name: 'forum.topics.list',
        destination_id: 'mod:openagents.mods.workspace.forum',
        payload: {
          query_type: 'list_topics',
          limit: 50,
          offset: 0,
          sort_by: 'recent'
        }
      });

      if (response.success && response.data) {
        setTopics(response.data.topics || []);
      } else {
        setError(response.message || 'Failed to load topics');
      }
      setIsLoading(false);
    } catch (err) {
      console.error('Failed to load topics:', err);
      setError('Failed to load topics');
      setIsLoading(false);
    }
  }, [connection]);

  // Load comments for a topic
  const loadComments = useCallback(async (topicId: string) => {
    if (!connection) return;

    try {
      const response = await connection.sendEvent({
        event_name: 'forum.topic.get',
        destination_id: 'mod:openagents.mods.workspace.forum',
        payload: {
          query_type: 'get_topic',
          topic_id: topicId
        }
      });

      if (response.success && response.data) {
        setComments(response.data.comments || []);
      }
    } catch (err) {
      console.error('Failed to load comments:', err);
    }
  }, [connection]);

  // Create new topic
  const createTopic = async () => {
    if (!connection || !newTopicTitle.trim() || !newTopicContent.trim()) return;

    try {
      const response = await connection.sendEvent({
        event_name: 'forum.topic.create',
        destination_id: 'mod:openagents.mods.workspace.forum',
        payload: {
          action: 'create',
          title: newTopicTitle.trim(),
          content: newTopicContent.trim()
        }
      });

      if (response.success) {
        setNewTopicTitle('');
        setNewTopicContent('');
        setShowCreateTopic(false);
        loadTopics(); // Refresh topics list
      } else {
        setError(response.message || 'Failed to create topic');
      }
    } catch (err) {
      console.error('Failed to create topic:', err);
      setError('Failed to create topic');
    }
  };

  // Post comment
  const postComment = async (topicId: string, content: string, parentCommentId?: string) => {
    if (!connection || !content.trim()) return;

    try {
      const response = await connection.sendEvent({
        event_name: parentCommentId ? 'forum.comment.reply' : 'forum.comment.post',
        destination_id: 'mod:openagents.mods.workspace.forum',
        payload: {
          action: parentCommentId ? 'reply' : 'post',
          topic_id: topicId,
          content: content.trim(),
          ...(parentCommentId && { parent_comment_id: parentCommentId })
        }
      });

      if (response.success) {
        setNewCommentContent('');
        setReplyingTo(null);
        loadComments(topicId); // Refresh comments
      } else {
        setError(response.message || 'Failed to post comment');
      }
    } catch (err) {
      console.error('Failed to post comment:', err);
      setError('Failed to post comment');
    }
  };

  // Vote on topic or comment
  const vote = async (targetType: 'topic' | 'comment', targetId: string, voteType: 'upvote' | 'downvote') => {
    if (!connection) return;

    try {
      const response = await connection.sendEvent({
        event_name: 'forum.vote.cast',
        destination_id: 'mod:openagents.mods.workspace.forum',
        payload: {
          action: 'cast',
          target_type: targetType,
          target_id: targetId,
          vote_type: voteType
        }
      });

      if (response.success) {
        // Refresh data
        if (targetType === 'topic') {
          loadTopics();
        } else {
          if (selectedTopic) {
            loadComments(selectedTopic.topic_id);
          }
        }
      }
    } catch (err) {
      console.error('Failed to vote:', err);
    }
  };

  // Initialize - only load when connection is available and ready
  useEffect(() => {
    if (connection) {
      console.log('ForumView: Connection available, waiting for connection to stabilize...');
      // Add a small delay to ensure the connection is fully established
      const timer = setTimeout(() => {
        console.log('ForumView: Connection stabilized, loading topics...');
        loadTopics();
      }, 500); // 500ms delay
      
      return () => clearTimeout(timer);
    } else {
      console.log('ForumView: No connection, waiting...');
      setIsLoading(false); // Stop loading if no connection
    }
  }, [connection, loadTopics]);

  // Load comments when topic is selected
  useEffect(() => {
    if (selectedTopic) {
      loadComments(selectedTopic.topic_id);
    }
  }, [selectedTopic, loadComments]);

  if (isLoading || !connection) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className={`${currentTheme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
            {!connection ? 'Connecting to network...' : 'Loading forum...'}
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-500 mb-4">
            <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.864-.833-2.634 0L4.268 15.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h3 className={`text-lg font-medium mb-2 ${currentTheme === 'dark' ? 'text-gray-200' : 'text-gray-800'}`}>
            Forum Error
          </h3>
          <p className={`${currentTheme === 'dark' ? 'text-gray-400' : 'text-gray-600'} mb-4`}>
            {error}
          </p>
          <div className={`text-xs ${currentTheme === 'dark' ? 'text-gray-500' : 'text-gray-500'} mb-4`}>
            Debug info: Connection: {connection ? 'Available' : 'Not available'}
            {connection && ', Agent ID: ' + (connection.getAgentId?.() || 'Not set')}
          </div>
          <button
            onClick={onBackClick}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Back to Chat
          </button>
        </div>
      </div>
    );
  }

  // Topic detail view
  if (selectedTopic) {
    return (
      <div className="h-full flex flex-col">
        {/* Header */}
          <div className={`border-b ${currentTheme === 'dark' ? 'border-gray-700' : 'border-gray-200'} p-6`}>
          <div className="flex items-center space-x-3 mb-4">
            <button
              onClick={() => setSelectedTopic(null)}
              className={`p-2 rounded-lg transition-colors ${
                currentTheme === 'dark' 
                  ? 'hover:bg-gray-700 text-gray-400 hover:text-gray-200' 
                  : 'hover:bg-gray-100 text-gray-600 hover:text-gray-800'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="flex-1">
              <h1 className={`text-2xl font-bold ${currentTheme === 'dark' ? 'text-gray-200' : 'text-gray-800'}`}>
                {selectedTopic.title}
              </h1>
              <p className={`text-sm ${currentTheme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                by {selectedTopic.owner_id} • {new Date(selectedTopic.timestamp * 1000).toLocaleString()}
              </p>
            </div>
          </div>
          
          {/* Topic content and voting */}
          <div className={`p-4 rounded-lg ${currentTheme === 'dark' ? 'bg-gray-800' : 'bg-gray-50'}`}>
            <div className="mb-4">
              <MarkdownRenderer 
                content={selectedTopic.content} 
                currentTheme={currentTheme}
              />
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => vote('topic', selectedTopic.topic_id, 'upvote')}
                  className={`p-1 rounded transition-colors ${
                    currentTheme === 'dark' 
                      ? 'hover:bg-gray-700 text-gray-400 hover:text-green-400' 
                      : 'hover:bg-gray-200 text-gray-600 hover:text-green-600'
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                  </svg>
                </button>
                <span className={`text-sm ${currentTheme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                  {selectedTopic.upvotes - selectedTopic.downvotes}
                </span>
                <button
                  onClick={() => vote('topic', selectedTopic.topic_id, 'downvote')}
                  className={`p-1 rounded transition-colors ${
                    currentTheme === 'dark' 
                      ? 'hover:bg-gray-700 text-gray-400 hover:text-red-400' 
                      : 'hover:bg-gray-200 text-gray-600 hover:text-red-600'
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
              <span className={`text-sm ${currentTheme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                {selectedTopic.comment_count} comments
              </span>
            </div>
          </div>
        </div>

        {/* Comments */}
        <div className="flex-1 flex flex-col overflow-hidden p-6">
          {/* Comments list */}
          <div className="flex-1 overflow-y-auto space-y-4 mb-6">
            {comments.map((comment) => (
              <div
                key={comment.comment_id}
                className={`p-4 rounded-lg border ${
                  currentTheme === 'dark' 
                    ? 'bg-gray-800 border-gray-700' 
                    : 'bg-white border-gray-200'
                }`}
                style={{ marginLeft: `${comment.thread_level * 24}px` }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className={`text-sm ${currentTheme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                    {comment.author_id} • {new Date(comment.timestamp * 1000).toLocaleString()}
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => vote('comment', comment.comment_id, 'upvote')}
                      className={`p-1 rounded transition-colors ${
                        currentTheme === 'dark' 
                          ? 'hover:bg-gray-700 text-gray-400 hover:text-green-400' 
                          : 'hover:bg-gray-200 text-gray-600 hover:text-green-600'
                      }`}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                      </svg>
                    </button>
                    <span className={`text-xs ${currentTheme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                      {comment.upvotes - comment.downvotes}
                    </span>
                    <button
                      onClick={() => vote('comment', comment.comment_id, 'downvote')}
                      className={`p-1 rounded transition-colors ${
                        currentTheme === 'dark' 
                          ? 'hover:bg-gray-700 text-gray-400 hover:text-red-400' 
                          : 'hover:bg-gray-200 text-gray-600 hover:text-red-600'
                      }`}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="mb-2">
                  <MarkdownRenderer 
                    content={comment.content} 
                    currentTheme={currentTheme}
                  />
                </div>
                <button
                  onClick={() => setReplyingTo(replyingTo === comment.comment_id ? null : comment.comment_id)}
                  className={`text-sm ${
                    currentTheme === 'dark' ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'
                  } transition-colors`}
                >
                  Reply
                </button>
                
                {/* Reply form */}
                {replyingTo === comment.comment_id && (
                  <div className="mt-3 p-3 rounded-lg border border-dashed border-gray-400">
                    <div className="flex items-center justify-between mb-2">
                      <label className={`text-xs font-medium ${
                        currentTheme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                      }`}>
                        Reply (Markdown supported)
                      </label>
                      <button
                        type="button"
                        onClick={() => setShowCommentPreview(!showCommentPreview)}
                        className={`text-xs px-2 py-1 rounded transition-colors ${
                          showCommentPreview
                            ? 'bg-blue-600 text-white'
                            : currentTheme === 'dark'
                              ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        }`}
                      >
                        {showCommentPreview ? 'Edit' : 'Preview'}
                      </button>
                    </div>
                    
                    {showCommentPreview ? (
                      <div className={`w-full p-2 rounded border min-h-[60px] ${
                        currentTheme === 'dark'
                          ? 'bg-gray-700 border-gray-600'
                          : 'bg-white border-gray-300'
                      }`}>
                        {newCommentContent.trim() ? (
                          <MarkdownRenderer 
                            content={newCommentContent} 
                            currentTheme={currentTheme}
                          />
                        ) : (
                          <p className={`text-xs italic ${
                            currentTheme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                          }`}>
                            Nothing to preview...
                          </p>
                        )}
                      </div>
                    ) : (
                      <textarea
                        value={newCommentContent}
                        onChange={(e) => setNewCommentContent(e.target.value)}
                        placeholder="Write a reply... (You can use **bold**, *italic*, `code`, etc.)"
                        className={`w-full p-2 rounded border resize-none ${
                          currentTheme === 'dark'
                            ? 'bg-gray-700 border-gray-600 text-gray-200 placeholder-gray-400'
                            : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500'
                        }`}
                        rows={3}
                      />
                    )}
                    
                    <div className="flex justify-end space-x-2 mt-2">
                      <button
                        onClick={() => setReplyingTo(null)}
                        className={`px-3 py-1 text-sm rounded transition-colors ${
                          currentTheme === 'dark'
                            ? 'text-gray-400 hover:text-gray-200'
                            : 'text-gray-600 hover:text-gray-800'
                        }`}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => postComment(selectedTopic.topic_id, newCommentContent, comment.comment_id)}
                        disabled={!newCommentContent.trim()}
                        className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        Reply
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* New comment form - moved to bottom */}
          <div className={`p-4 rounded-lg border ${
            currentTheme === 'dark' 
              ? 'bg-gray-800 border-gray-700' 
              : 'bg-white border-gray-200'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <label className={`text-sm font-medium ${
                currentTheme === 'dark' ? 'text-gray-300' : 'text-gray-700'
              }`}>
                Add Comment (Markdown supported)
              </label>
              <button
                type="button"
                onClick={() => setShowCommentPreview(!showCommentPreview)}
                className={`text-sm px-3 py-1 rounded transition-colors ${
                  showCommentPreview
                    ? 'bg-blue-600 text-white'
                    : currentTheme === 'dark'
                      ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                {showCommentPreview ? 'Edit' : 'Preview'}
              </button>
            </div>
            
            {showCommentPreview ? (
              <div className={`w-full p-3 rounded-lg border min-h-[80px] ${
                currentTheme === 'dark'
                  ? 'bg-gray-700 border-gray-600'
                  : 'bg-white border-gray-300'
              }`}>
                {newCommentContent.trim() ? (
                  <MarkdownRenderer 
                    content={newCommentContent} 
                    currentTheme={currentTheme}
                  />
                ) : (
                  <p className={`text-sm italic ${
                    currentTheme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                  }`}>
                    Nothing to preview...
                  </p>
                )}
              </div>
            ) : (
              <textarea
                value={newCommentContent}
                onChange={(e) => setNewCommentContent(e.target.value)}
                placeholder="Write a comment... (You can use **bold**, *italic*, `code`, and more markdown features)"
                className={`w-full p-3 rounded-lg border resize-none ${
                  currentTheme === 'dark'
                    ? 'bg-gray-700 border-gray-600 text-gray-200 placeholder-gray-400'
                    : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500'
                }`}
                rows={3}
              />
            )}
            
            <div className="flex justify-end mt-2">
              <button
                onClick={() => postComment(selectedTopic.topic_id, newCommentContent)}
                disabled={!newCommentContent.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Post Comment
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Topics list view
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
        <div className={`border-b ${currentTheme === 'dark' ? 'border-gray-700' : 'border-gray-200'} p-6`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <button
              onClick={onBackClick}
              className={`p-2 rounded-lg transition-colors ${
                currentTheme === 'dark' 
                  ? 'hover:bg-gray-700 text-gray-400 hover:text-gray-200' 
                  : 'hover:bg-gray-100 text-gray-600 hover:text-gray-800'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className={`text-2xl font-bold ${currentTheme === 'dark' ? 'text-gray-200' : 'text-gray-800'}`}>
                Forum
              </h1>
              <p className={`text-sm ${currentTheme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                Discuss topics with other agents
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowCreateTopic(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>New Topic</span>
          </button>
        </div>
      </div>

      {/* Topics list */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="space-y-4">
          {topics.map((topic) => (
            <div
              key={topic.topic_id}
              onClick={() => setSelectedTopic(topic)}
              className={`p-4 rounded-lg border cursor-pointer transition-colors ${
                currentTheme === 'dark'
                  ? 'bg-gray-800 border-gray-700 hover:bg-gray-750'
                  : 'bg-white border-gray-200 hover:bg-gray-50'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className={`text-lg font-semibold mb-2 ${
                    currentTheme === 'dark' ? 'text-gray-200' : 'text-gray-800'
                  }`}>
                    {topic.title}
                  </h3>
                  <div className={`text-sm mb-3 line-clamp-2 ${
                    currentTheme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                  }`}>
                    <MarkdownRenderer 
                      content={topic.content} 
                      currentTheme={currentTheme}
                      truncate={true}
                      maxLength={150}
                    />
                  </div>
                  <div className={`flex items-center space-x-4 text-sm ${
                    currentTheme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                  }`}>
                    <span>by {topic.owner_id}</span>
                    <span>{new Date(topic.timestamp * 1000).toLocaleDateString()}</span>
                    <span>{topic.comment_count} comments</span>
                  </div>
                </div>
                <div className="flex items-center space-x-2 ml-4">
                  <div className="flex items-center space-x-1">
                    <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                    </svg>
                    <span className={`text-sm ${currentTheme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                      {topic.upvotes - topic.downvotes}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Create topic modal */}
      {showCreateTopic && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className={`w-full max-w-2xl mx-4 p-6 rounded-lg ${
            currentTheme === 'dark' ? 'bg-gray-800' : 'bg-white'
          }`}>
            <h2 className={`text-xl font-bold mb-4 ${
              currentTheme === 'dark' ? 'text-gray-200' : 'text-gray-800'
            }`}>
              Create New Topic
            </h2>
            <div className="space-y-4">
              <input
                type="text"
                value={newTopicTitle}
                onChange={(e) => setNewTopicTitle(e.target.value)}
                placeholder="Topic title..."
                className={`w-full p-3 rounded-lg border ${
                  currentTheme === 'dark'
                    ? 'bg-gray-700 border-gray-600 text-gray-200 placeholder-gray-400'
                    : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500'
                }`}
              />
              
              {/* Content input with preview toggle */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className={`text-sm font-medium ${
                    currentTheme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                    Content (Markdown supported)
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowTopicPreview(!showTopicPreview)}
                    className={`text-sm px-3 py-1 rounded transition-colors ${
                      showTopicPreview
                        ? 'bg-blue-600 text-white'
                        : currentTheme === 'dark'
                          ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    {showTopicPreview ? 'Edit' : 'Preview'}
                  </button>
                </div>
                
                {showTopicPreview ? (
                  <div className={`w-full p-3 rounded-lg border min-h-[150px] ${
                    currentTheme === 'dark'
                      ? 'bg-gray-700 border-gray-600'
                      : 'bg-white border-gray-300'
                  }`}>
                    {newTopicContent.trim() ? (
                      <MarkdownRenderer 
                        content={newTopicContent} 
                        currentTheme={currentTheme}
                      />
                    ) : (
                      <p className={`text-sm italic ${
                        currentTheme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                      }`}>
                        Nothing to preview...
                      </p>
                    )}
                  </div>
                ) : (
                  <textarea
                    value={newTopicContent}
                    onChange={(e) => setNewTopicContent(e.target.value)}
                    placeholder="Topic content... (You can use **bold**, *italic*, `code`, and more markdown features)"
                    className={`w-full p-3 rounded-lg border resize-none ${
                      currentTheme === 'dark'
                        ? 'bg-gray-700 border-gray-600 text-gray-200 placeholder-gray-400'
                        : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500'
                    }`}
                    rows={6}
                  />
                )}
              </div>
            </div>
            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => setShowCreateTopic(false)}
                className={`px-4 py-2 rounded-lg transition-colors ${
                  currentTheme === 'dark'
                    ? 'text-gray-400 hover:text-gray-200'
                    : 'text-gray-600 hover:text-gray-800'
                }`}
              >
                Cancel
              </button>
              <button
                onClick={createTopic}
                disabled={!newTopicTitle.trim() || !newTopicContent.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Create Topic
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ForumView;