/**
 * Utility for tracking read messages in localStorage
 */

interface ReadMessageState {
  [channelKey: string]: Set<string>; // channelKey -> Set of read message IDs
}

class ReadMessageTracker {
  private static readonly STORAGE_KEY = 'openagents_read_messages';
  private static readonly MAX_MESSAGES_PER_CHANNEL = 1000; // Prevent unlimited growth
  
  private readMessages: ReadMessageState = {};

  constructor() {
    this.loadFromStorage();
  }

  /**
   * Load read message state from localStorage
   */
  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(ReadMessageTracker.STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Convert arrays back to Sets
        this.readMessages = {};
        for (const [channelKey, messageIds] of Object.entries(parsed)) {
          this.readMessages[channelKey] = new Set(messageIds as string[]);
        }
      }
    } catch (error) {
      console.warn('Failed to load read messages from localStorage:', error);
      this.readMessages = {};
    }
  }

  /**
   * Save read message state to localStorage
   */
  private saveToStorage(): void {
    try {
      // Convert Sets to arrays for JSON serialization
      const toStore: Record<string, string[]> = {};
      for (const [channelKey, messageIdSet] of Object.entries(this.readMessages)) {
        toStore[channelKey] = Array.from(messageIdSet);
      }
      localStorage.setItem(ReadMessageTracker.STORAGE_KEY, JSON.stringify(toStore));
    } catch (error) {
      console.warn('Failed to save read messages to localStorage:', error);
    }
  }

  /**
   * Mark a message as read
   */
  markAsRead(channelKey: string, messageId: string): void {
    if (!this.readMessages[channelKey]) {
      this.readMessages[channelKey] = new Set();
    }
    
    this.readMessages[channelKey].add(messageId);
    
    // Cleanup: keep only the most recent messages per channel
    if (this.readMessages[channelKey].size > ReadMessageTracker.MAX_MESSAGES_PER_CHANNEL) {
      const messageArray = Array.from(this.readMessages[channelKey]);
      const toKeep = messageArray.slice(-ReadMessageTracker.MAX_MESSAGES_PER_CHANNEL);
      this.readMessages[channelKey] = new Set(toKeep);
    }
    
    this.saveToStorage();
  }

  /**
   * Mark multiple messages as read
   */
  markMultipleAsRead(channelKey: string, messageIds: string[]): void {
    if (!this.readMessages[channelKey]) {
      this.readMessages[channelKey] = new Set();
    }
    
    messageIds.forEach(id => this.readMessages[channelKey].add(id));
    
    // Cleanup
    if (this.readMessages[channelKey].size > ReadMessageTracker.MAX_MESSAGES_PER_CHANNEL) {
      const messageArray = Array.from(this.readMessages[channelKey]);
      const toKeep = messageArray.slice(-ReadMessageTracker.MAX_MESSAGES_PER_CHANNEL);
      this.readMessages[channelKey] = new Set(toKeep);
    }
    
    this.saveToStorage();
  }

  /**
   * Check if a message is read
   */
  isMessageRead(channelKey: string, messageId: string): boolean {
    return this.readMessages[channelKey]?.has(messageId) || false;
  }

  /**
   * Get count of unread messages in a channel
   */
  getUnreadCount(channelKey: string, allMessageIds: string[]): number {
    if (!this.readMessages[channelKey]) {
      return allMessageIds.length;
    }
    
    const readSet = this.readMessages[channelKey];
    return allMessageIds.filter(id => !readSet.has(id)).length;
  }

  /**
   * Mark all messages in a channel as read (when user opens channel)
   */
  markChannelAsRead(channelKey: string, allMessageIds: string[]): void {
    this.markMultipleAsRead(channelKey, allMessageIds);
  }

  /**
   * Get all unread message IDs for a channel
   */
  getUnreadMessageIds(channelKey: string, allMessageIds: string[]): string[] {
    if (!this.readMessages[channelKey]) {
      return allMessageIds;
    }
    
    const readSet = this.readMessages[channelKey];
    return allMessageIds.filter(id => !readSet.has(id));
  }

  /**
   * Clear all read message data (for debugging or reset)
   */
  clearAll(): void {
    this.readMessages = {};
    localStorage.removeItem(ReadMessageTracker.STORAGE_KEY);
  }
}

// Export singleton instance
export const readMessageTracker = new ReadMessageTracker();

export default ReadMessageTracker;


