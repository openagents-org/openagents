interface EventRouter {
  initialize: (connection: any) => void;
  cleanup: () => void;
  onForumEvent: (handler: (event: any) => void) => void;
  onChatEvent: (handler: (event: any) => void) => void;
  onWikiEvent: (handler: (event: any) => void) => void;
  onDocumentEvent: (handler: (event: any) => void) => void;
  offForumEvent: (handler: (event: any) => void) => void;
  offChatEvent: (handler: (event: any) => void) => void;
  offWikiEvent: (handler: (event: any) => void) => void;
  offDocumentEvent: (handler: (event: any) => void) => void;
}

class EventRouterImpl implements EventRouter {
  private connection: any = null;
  private processedEventIds = new Set<string>();
  private forumHandlers = new Set<(event: any) => void>();
  private chatHandlers = new Set<(event: any) => void>();
  private wikiHandlers = new Set<(event: any) => void>();
  private documentHandlers = new Set<(event: any) => void>();
  private feedHandlers = new Set<(event: any) => void>();
  private rawEventHandler: ((event: any) => void) | null = null;

  initialize(connection: any) {
    if (this.connection === connection) return;

    this.cleanup();
    this.connection = connection;

    if (!connection) return;

    console.log("EventRouter: Initializing with connection");

    this.rawEventHandler = (event: any) => {
      this.handleRawEvent(event);
    };

    connection.on("rawEvent", this.rawEventHandler);
  }

  cleanup() {
    if (this.connection && this.rawEventHandler) {
      console.log("EventRouter: Cleaning up event listeners");
      this.connection.off("rawEvent", this.rawEventHandler);
    }

    this.connection = null;
    this.rawEventHandler = null;
    this.processedEventIds.clear();
  }

  private handleRawEvent(event: any) {
    console.log(`📨 EventRouter: Received event: ${event.event_name}`, event);

    // Prevent duplicate processing using event_id
    if (event.event_id && this.processedEventIds.has(event.event_id)) {
      console.log(`EventRouter: Skipping duplicate event: ${event.event_id}`);
      return;
    }

    if (event.event_id) {
      this.processedEventIds.add(event.event_id);
    }

    // Route events based on event name prefix
    const eventName = event.event_name || '';

    if (eventName.startsWith('forum.')) {
      console.log(`EventRouter: Routing forum event: ${eventName}`);
      this.forumHandlers.forEach(handler => {
        try {
          handler(event);
        } catch (error) {
          console.error(`EventRouter: Error in forum event handler:`, error);
        }
      });
    } else if (eventName.startsWith('chat.') || eventName.startsWith('messaging.') || eventName.startsWith('thread.') || eventName.startsWith('project.')) {
      console.log(`EventRouter: Routing chat/project event: ${eventName}`);
      this.chatHandlers.forEach(handler => {
        try {
          handler(event);
        } catch (error) {
          console.error(`EventRouter: Error in chat event handler:`, error);
        }
      });
    } else if (eventName.startsWith('wiki.')) {
      console.log(`EventRouter: Routing wiki event: ${eventName}`);
      this.wikiHandlers.forEach(handler => {
        try {
          handler(event);
        } catch (error) {
          console.error(`EventRouter: Error in wiki event handler:`, error);
        }
      });
    } else if (eventName.startsWith('document.')) {
      console.log(`EventRouter: Routing document event: ${eventName}`);
      this.documentHandlers.forEach(handler => {
        try {
          handler(event);
        } catch (error) {
          console.error(`EventRouter: Error in document event handler:`, error);
        }
      });
    } else if (eventName.startsWith('feed.')) {
      console.log(`EventRouter: Routing feed event: ${eventName}`);
      this.feedHandlers.forEach(handler => {
        try {
          handler(event);
        } catch (error) {
          console.error(`EventRouter: Error in feed event handler:`, error);
        }
      });
    } else {
      console.log(`EventRouter: Unhandled event type: ${eventName}`);
    }

    // Clean up old event IDs to prevent memory leak (keep last 1000)
    if (this.processedEventIds.size > 1000) {
      const eventIds = Array.from(this.processedEventIds);
      const toRemove = eventIds.slice(0, eventIds.length - 1000);
      toRemove.forEach(id => this.processedEventIds.delete(id));
    }
  }

  onForumEvent(handler: (event: any) => void) {
    this.forumHandlers.add(handler);
    console.log(`EventRouter: Added forum event handler. Total: ${this.forumHandlers.size}`);
  }

  onChatEvent(handler: (event: any) => void) {
    this.chatHandlers.add(handler);
    console.log(`EventRouter: Added chat event handler. Total: ${this.chatHandlers.size}`);
  }

  onWikiEvent(handler: (event: any) => void) {
    this.wikiHandlers.add(handler);
    console.log(`EventRouter: Added wiki event handler. Total: ${this.wikiHandlers.size}`);
  }

  onDocumentEvent(handler: (event: any) => void) {
    this.documentHandlers.add(handler);
    console.log(`EventRouter: Added document event handler. Total: ${this.documentHandlers.size}`);
  }

  onFeedEvent(handler: (event: any) => void) {
    this.feedHandlers.add(handler);
    console.log(`EventRouter: Added feed event handler. Total: ${this.feedHandlers.size}`);
  }

  offForumEvent(handler: (event: any) => void) {
    this.forumHandlers.delete(handler);
    console.log(`EventRouter: Removed forum event handler. Total: ${this.forumHandlers.size}`);
  }

  offChatEvent(handler: (event: any) => void) {
    this.chatHandlers.delete(handler);
    console.log(`EventRouter: Removed chat event handler. Total: ${this.chatHandlers.size}`);
  }

  offWikiEvent(handler: (event: any) => void) {
    this.wikiHandlers.delete(handler);
    console.log(`EventRouter: Removed wiki event handler. Total: ${this.wikiHandlers.size}`);
  }

  offDocumentEvent(handler: (event: any) => void) {
    this.documentHandlers.delete(handler);
    console.log(`EventRouter: Removed document event handler. Total: ${this.documentHandlers.size}`);
  }

  offFeedEvent(handler: (event: any) => void) {
    this.feedHandlers.delete(handler);
    console.log(`EventRouter: Removed feed event handler. Total: ${this.feedHandlers.size}`);
  }
}

export const eventRouter = new EventRouterImpl();