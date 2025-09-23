/**
 * Simple localStorage-based store for tracking read message IDs
 * Key format: openagents_read_messages_${networkHost}_${networkPort}_${userId}
 */

export class ReadMessageStore {
  private storageKey: string;
  private readMessageIds: Set<string> = new Set();

  constructor(networkHost: string, networkPort: number, userId: string) {
    this.storageKey = `openagents_read_messages_${networkHost}_${networkPort}_${userId}`;
    this.loadFromStorage();
  }

  /**
   * Load read message IDs from localStorage
   */
  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const messageIds = JSON.parse(stored) as string[];
        this.readMessageIds = new Set(messageIds);
        console.log(`📖 Loaded ${this.readMessageIds.size} read message IDs from storage`);
      }
    } catch (error) {
      console.warn('Failed to load read messages from localStorage:', error);
      this.readMessageIds = new Set();
    }
  }

  /**
   * Save read message IDs to localStorage
   */
  private saveToStorage(): void {
    try {
      const messageIds = Array.from(this.readMessageIds);
      localStorage.setItem(this.storageKey, JSON.stringify(messageIds));
      console.log(`💾 Saved ${messageIds.length} read message IDs to storage`);
    } catch (error) {
      console.warn('Failed to save read messages to localStorage:', error);
    }
  }

  /**
   * Mark a single message as read
   */
  markAsRead(messageId: string): void {
    this.readMessageIds.add(messageId);
    this.saveToStorage();
  }

  /**
   * Mark multiple messages as read (e.g., all messages in a channel)
   */
  markMultipleAsRead(messageIds: string[]): void {
    let changed = false;
    messageIds.forEach(id => {
      if (!this.readMessageIds.has(id)) {
        this.readMessageIds.add(id);
        changed = true;
      }
    });
    
    if (changed) {
      this.saveToStorage();
      console.log(`📖 Marked ${messageIds.length} messages as read`);
    }
  }

  /**
   * Check if a message is read
   */
  isRead(messageId: string): boolean {
    return this.readMessageIds.has(messageId);
  }

  /**
   * Get count of unread messages from a list
   */
  getUnreadCount(allMessageIds: string[]): number {
    return allMessageIds.filter(id => !this.readMessageIds.has(id)).length;
  }

  /**
   * Get all unread message IDs from a list
   */
  getUnreadMessageIds(allMessageIds: string[]): string[] {
    return allMessageIds.filter(id => !this.readMessageIds.has(id));
  }

  /**
   * Clear all read message data (for debugging or reset)
   */
  clear(): void {
    this.readMessageIds.clear();
    localStorage.removeItem(this.storageKey);
    console.log('🗑️ Cleared all read message data');
  }

  /**
   * Get total count of read messages
   */
  getTotalReadCount(): number {
    return this.readMessageIds.size;
  }

  /**
   * Mark all messages in a channel as read
   */
  markChannelAsRead(channel: string, messageIds: string[]): void {
    messageIds.forEach(id => this.readMessageIds.add(id));
    this.saveToStorage();
    console.log(`📖 Marked ${messageIds.length} messages in #${channel} as read`);
  }

  /**
   * Mark all direct messages with an agent as read
   */
  markDirectMessageAsRead(agentId: string, messageIds: string[]): void {
    messageIds.forEach(id => this.readMessageIds.add(id));
    this.saveToStorage();
    console.log(`📖 Marked ${messageIds.length} direct messages with ${agentId} as read`);
  }
}

export default ReadMessageStore;



