/**
 * Forum notifications hook for real-time forum updates
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useOpenAgentsService } from '@/contexts/OpenAgentsServiceContext';

export interface ForumNotification {
  id: string;
  type: 'topic_created' | 'topic_updated' | 'comment_posted' | 'comment_replied' | 'vote_cast';
  title: string;
  message: string;
  timestamp: number;
  data?: any;
  read: boolean;
}

interface UseForumNotificationsProps {
  enabled?: boolean;
  currentUserId?: string;
}

export const useForumNotifications = ({
  enabled = true,
  currentUserId
}: UseForumNotificationsProps = {}) => {
  const [notifications, setNotifications] = useState<ForumNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const { service: openAgentsService } = useOpenAgentsService();
  const eventHandlersRef = useRef<{ [key: string]: (event: any) => void }>({});

  // Handle forum topic notifications
  const handleTopicCreated = useCallback((event: any) => {
    if (!event.payload?.topic) return;

    const topic = event.payload.topic;
    const notification: ForumNotification = {
      id: `topic_created_${topic.topic_id}_${Date.now()}`,
      type: 'topic_created',
      title: 'New Topic Created',
      message: `"${topic.title}" by ${topic.owner_id}`,
      timestamp: Date.now(),
      data: { topic },
      read: false,
    };

    setNotifications(prev => [notification, ...prev.slice(0, 49)]); // Keep max 50 notifications
  }, []);

  const handleTopicUpdated = useCallback((event: any) => {
    if (!event.payload?.topic) return;

    const topic = event.payload.topic;
    const notification: ForumNotification = {
      id: `topic_updated_${topic.topic_id}_${Date.now()}`,
      type: 'topic_updated',
      title: 'Topic Updated',
      message: `"${topic.title}" was edited`,
      timestamp: Date.now(),
      data: { topic },
      read: false,
    };

    setNotifications(prev => [notification, ...prev.slice(0, 49)]);
  }, []);

  // Handle forum comment notifications
  const handleCommentPosted = useCallback((event: any) => {
    if (!event.payload?.comment) return;

    const comment = event.payload.comment;
    // Don't notify user about their own comments
    if (comment.author_id === currentUserId) return;

    const notification: ForumNotification = {
      id: `comment_posted_${comment.comment_id}_${Date.now()}`,
      type: 'comment_posted',
      title: 'New Comment',
      message: `${comment.author_id} commented on a topic`,
      timestamp: Date.now(),
      data: { comment },
      read: false,
    };

    setNotifications(prev => [notification, ...prev.slice(0, 49)]);
  }, [currentUserId]);

  const handleCommentReplied = useCallback((event: any) => {
    if (!event.payload?.comment) return;

    const comment = event.payload.comment;
    // Don't notify user about their own replies
    if (comment.author_id === currentUserId) return;

    const notification: ForumNotification = {
      id: `comment_replied_${comment.comment_id}_${Date.now()}`,
      type: 'comment_replied',
      title: 'New Reply',
      message: `${comment.author_id} replied to a comment`,
      timestamp: Date.now(),
      data: { comment },
      read: false,
    };

    setNotifications(prev => [notification, ...prev.slice(0, 49)]);
  }, [currentUserId]);

  // Set up event handlers
  useEffect(() => {
    if (!enabled || !openAgentsService || !currentUserId) return;

    const handlers = {
      'forum.topic.created': handleTopicCreated,
      'forum.topic.edited': handleTopicUpdated,
      'forum.comment.posted': handleCommentPosted,
      'forum.comment.replied': handleCommentReplied,
    };

    eventHandlersRef.current = handlers;

    // Register event handlers
    Object.entries(handlers).forEach(([eventName, handler]) => {
      openAgentsService.on(eventName, handler);
    });

    console.log('Forum notifications: Event handlers registered');

    return () => {
      // Clean up event handlers
      if (eventHandlersRef.current) {
        Object.entries(eventHandlersRef.current).forEach(([eventName, handler]) => {
          openAgentsService.off(eventName, handler);
        });
      }
      console.log('Forum notifications: Event handlers cleaned up');
    };
  }, [enabled, openAgentsService, currentUserId, handleTopicCreated, handleTopicUpdated, handleCommentPosted, handleCommentReplied]);

  // Update unread count when notifications change
  useEffect(() => {
    const unread = notifications.filter(n => !n.read).length;
    setUnreadCount(unread);
  }, [notifications]);

  // Mark notification as read
  const markAsRead = useCallback((notificationId: string) => {
    setNotifications(prev =>
      prev.map(n => n.id === notificationId ? { ...n, read: true } : n)
    );
  }, []);

  // Mark all notifications as read
  const markAllAsRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  // Clear all notifications
  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  // Remove specific notification
  const removeNotification = useCallback((notificationId: string) => {
    setNotifications(prev => prev.filter(n => n.id !== notificationId));
  }, []);

  return {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    clearAll,
    removeNotification,
  };
};

export default useForumNotifications;