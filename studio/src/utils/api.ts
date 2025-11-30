interface ChatResponse {
  message: string;
  conversationId: string;
}

// Store active requests for aborting
const activeRequests = new Map<string, AbortController>();

// Parse SSE event to JSON object
const parseSSEEvent = (eventText: string): any => {
  try {
    // Try direct JSON parsing first for the backend format
    return JSON.parse(eventText);
  } catch (e) {
    console.error("Error parsing JSON:", eventText, e);
    return null;
  }
};

// API functions
export const sendChatMessage = async (
  message: string, 
  conversationId: string, 
  options: {
    onChunk?: (chunk: string) => void,
    onComplete?: (fullMessage: string) => void,
    onError?: (error: any) => void,
    streamOutput?: boolean
  } = {}
): Promise<any> => {
  const { 
    onChunk, 
    onComplete, 
    onError,
    streamOutput = true
  } = options;

  // Create an abort controller for this request
  const abortController = new AbortController();
  activeRequests.set(conversationId, abortController);

  try {
    // --- Call backend API --- 
    const backendHeaders: Record<string, string> = {
        'Content-Type': 'application/json'
    };

    if (streamOutput && onChunk) {
      // Create fetch request with AbortSignal
      console.log('Sending streaming request:', {
        url: '/api/chat',
        message: message.substring(0, 50) + (message.length > 50 ? '...' : ''),
        conversationId,
        streamOutput: true
      });

      const response = await fetch(`/api/chat`, {
        method: 'POST',
        headers: backendHeaders,
        body: JSON.stringify({
          message,
          conversationId,
          streamOutput: true
        }),
        signal: abortController.signal
      });

      if (!response.ok) {
        let errorBody = `Server error: ${response.status}`;
        try {
            const errorData = await response.json();
            errorBody = errorData.error || errorBody;
        } catch (e) { /* Ignore parsing error */ }
        throw new Error(errorBody);
      }

      if (!response.body) {
        throw new Error('Response body is not readable');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullMessage = '';

      try {
        console.log('Starting to read streaming response...');
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            console.log('Streaming response reading completed');
            break;
          }

          // Simple decode of current data chunk
          const chunk = decoder.decode(value, { stream: true });
          console.log('Received raw data:', chunk);
          
          // Try to parse the chunk directly as JSON
          try {
            const lines = chunk.split('\n').filter(line => line.trim());
            
            for (const line of lines) {
              const data = parseSSEEvent(line);
              if (!data) continue;
              
              if (data.type === 'start') {
                console.log('Streaming response started, conversation ID:', data.conversationId);
              } else if (data.type === 'chunk' && data.chunk) {
                console.log('Received text chunk:', data.chunk);
                onChunk(data.chunk);
                fullMessage += data.chunk;
              } else if (data.type === 'end' && data.message) {
                console.log('Streaming response ended, complete message received');
                fullMessage = data.message; // Use complete message from end event
                if (onComplete) {
                  onComplete(fullMessage);
                }
              } else if (data.type === 'error') {
                throw new Error(data.error || 'Unknown streaming response error');
              }
            }
          } catch (parseError) {
            console.error('Error parsing data chunk:', parseError);
          }
        }

        return {
          message: fullMessage,
          conversationId
        };
      } catch (streamError) {
        console.error('Error processing streaming response:', streamError);
        if (onError) onError(streamError);
        throw streamError;
      } finally {
        reader.releaseLock();
        activeRequests.delete(conversationId);
        console.log('Cleanup of streaming request resources completed');
      }
    } else {
      // Non-streaming request
      console.log('Sending non-streaming request:', {
        url: '/api/chat',
        message: message.substring(0, 50) + (message.length > 50 ? '...' : ''),
        conversationId,
        streamOutput: false
      });
      
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: backendHeaders,
        body: JSON.stringify({
          message,
          conversationId,
          streamOutput: false
        }),
        signal: abortController.signal
      });
      
      if (!response.ok) {
        let errorBody = `Server error: ${response.status}`;
        try {
            const errorData = await response.json();
            errorBody = errorData.error || errorBody;
        } catch (e) { /* Ignore parsing error */ }
        throw new Error(errorBody);
      }
      
      const data = await response.json();
      console.log('Received non-streaming response:', {
        conversationId,
        messageLength: data.message ? data.message.length : 0
      });
      
      if (onComplete) {
        onComplete(data.message);
      }
      
      return data;
    }
  } catch (error: any) {
    // Check if this was an abort error
    if (error.name === 'AbortError') {
      console.log('Request aborted');
    } else {
      console.error('Error sending chat message:', error);
      if (onError) {
        onError(error);
      }
    }
    return Promise.reject(error);
  } finally {
    activeRequests.delete(conversationId);
  }
};

export const abortChatMessage = async (conversationId: string): Promise<boolean> => {
  const abortController = activeRequests.get(conversationId);
  
  if (abortController) {
    // Abort the request
    abortController.abort();
    activeRequests.delete(conversationId);
    
    try {
      // Also notify backend to abort if possible
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };

      const response = await fetch('/api/chat/abort', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          conversationId
        })
      });
      
      if (response.ok) {
        console.log('Successfully sent abort request to backend.');
        return true;
      } else {
        console.warn(`Failed to abort on backend: ${response.status} ${response.statusText}`);
        return false;
      }
    } catch (error) {
      console.error('Error sending abort request to backend:', error);
      return false;
    }
  } else {
    console.warn(`No active request found for conversation ${conversationId}`);
    return false;
  }
};

// export const getServerStatus = async (): Promise<any> => { ... }; 