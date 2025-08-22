import { useState, useCallback, useEffect } from 'react';
import { Conversation } from '../types';
import { v4 as uuidv4 } from 'uuid';

export default function useConversation() {
  // Use UUID to generate initial conversation ID
  const initialId = `conv_${uuidv4()}`;
  const [activeConversationId, setActiveConversationId] = useState<string>(initialId);
  const [conversations, setConversations] = useState<Conversation[]>([
    { id: initialId, title: 'New conversation', isActive: true }
  ]);
  const [isLoading, setIsLoading] = useState(false);

  // Initialize without authentication - network selection handles connection
  useEffect(() => {
    console.log("Conversation hook initialized");
  }, []);

  // Load session from backend (simplified without authentication)
  const loadSession = useCallback(async () => {
    try {
      setIsLoading(true);
      console.log("Loading sessions from backend");
      
      // For now, just return false to use local sessions
      // In the future, this could be updated to work with the OpenAgents network API
      return false;
    } catch (error) {
      console.error('Error loading sessions:', error);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Save conversation to backend (simplified without authentication)
  const saveConversation = useCallback(async (conversationId: string, isActive: boolean = false) => {
    try {
      // Get the conversation from state
      const conversation = conversations.find(c => c.id === conversationId);
      if (!conversation) {
        console.error(`Conversation ${conversationId} not found in state for saving`);
        return;
      }
      
      console.log(`Would save conversation: ${conversationId}, isActive: ${isActive}, Title: ${conversation.title}`);
      // In the future, this could be updated to work with the OpenAgents network API
    } catch (error) {
      console.error(`Error saving conversation ${conversationId}:`, error);
    }
  }, [conversations]);

  // Initialization logic
  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    const initialize = async () => {
      if (initialized) return;
      
      console.log("Initializing conversation hook...");
      
      // Try to load existing sessions
      const hasExistingSessions = await loadSession();
      
      if (!hasExistingSessions) {
        console.log("No existing sessions found, using default conversation");
        // Keep the initial conversation
      }
      
      setInitialized(true);
    };

    initialize();
  }, [loadSession, initialized]);

  // Create a new conversation
  const createNewConversation = useCallback(() => {
    const newId = `conv_${uuidv4()}`;
    const newConversation: Conversation = {
      id: newId,
      title: 'New conversation',
      isActive: true
    };

    // Update conversations state - set all to inactive first
    setConversations(prev => 
      [...prev.map(c => ({ ...c, isActive: false })), newConversation]
    );
    
    setActiveConversationId(newId);
    console.log(`Created new conversation: ${newId}`);
  }, []);

  // Switch to an existing conversation
  const handleConversationChange = useCallback((conversationId: string) => {
    setConversations(prev => 
      prev.map(c => ({ 
        ...c, 
        isActive: c.id === conversationId 
      }))
    );
    setActiveConversationId(conversationId);
    console.log(`Switched to conversation: ${conversationId}`);
  }, []);

  // Delete a conversation
  const deleteConversation = useCallback((conversationId: string) => {
    setConversations(prev => {
      const filtered = prev.filter(c => c.id !== conversationId);
      
      // If we deleted the active conversation and there are others, activate the first one
      if (conversationId === activeConversationId && filtered.length > 0) {
        filtered[0].isActive = true;
        setActiveConversationId(filtered[0].id);
      }
      
      return filtered;
    });
    
    console.log(`Deleted conversation: ${conversationId}`);
  }, [activeConversationId]);

  // Update conversation title
  const updateConversationTitle = useCallback((conversationId: string, newTitle: string) => {
    setConversations(prev => 
      prev.map(c => 
        c.id === conversationId 
          ? { ...c, title: newTitle }
          : c
      )
    );
    
    // Save the updated conversation
    saveConversation(conversationId, conversationId === activeConversationId);
  }, [activeConversationId, saveConversation]);

  return {
    activeConversationId,
    conversations,
    isLoading,
    createNewConversation,
    handleConversationChange,
    deleteConversation,
    updateConversationTitle,
    loadSession,
    saveConversation
  };
}