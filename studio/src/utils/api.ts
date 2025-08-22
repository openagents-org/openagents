interface ChatResponse {
  message: string;
  conversationId: string;
}

// Store active requests for aborting
const activeRequests = new Map<string, AbortController>();

// 将SSE事件解析为JSON对象
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
    // --- 调用后端 API --- 
    const backendHeaders: Record<string, string> = {
        'Content-Type': 'application/json'
    };

    if (streamOutput && onChunk) {
      // 创建带有 AbortSignal 的 fetch 请求
      console.log('发送流式请求:', {
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
        let errorBody = `服务器错误: ${response.status}`;
        try {
            const errorData = await response.json();
            errorBody = errorData.error || errorBody;
        } catch (e) { /* 忽略解析错误 */ }
        throw new Error(errorBody);
      }

      if (!response.body) {
        throw new Error('响应主体不可读');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullMessage = '';

      try {
        console.log('开始读取流式响应...');
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            console.log('流式响应读取完成');
            break;
          }

          // 简单解码当前数据块
          const chunk = decoder.decode(value, { stream: true });
          console.log('收到原始数据:', chunk);
          
          // 尝试将块直接解析为JSON
          try {
            const lines = chunk.split('\n').filter(line => line.trim());
            
            for (const line of lines) {
              const data = parseSSEEvent(line);
              if (!data) continue;
              
              if (data.type === 'start') {
                console.log('流式响应开始, 对话ID:', data.conversationId);
              } else if (data.type === 'chunk' && data.chunk) {
                console.log('接收到文本块:', data.chunk);
                onChunk(data.chunk);
                fullMessage += data.chunk;
              } else if (data.type === 'end' && data.message) {
                console.log('流式响应结束, 完整消息已接收');
                fullMessage = data.message; // Use complete message from end event
                if (onComplete) {
                  onComplete(fullMessage);
                }
              } else if (data.type === 'error') {
                throw new Error(data.error || '未知流式响应错误');
              }
            }
          } catch (parseError) {
            console.error('解析数据块时出错:', parseError);
          }
        }

        return {
          message: fullMessage,
          conversationId
        };
      } catch (streamError) {
        console.error('处理流式响应时出错:', streamError);
        if (onError) onError(streamError);
        throw streamError;
      } finally {
        reader.releaseLock();
        activeRequests.delete(conversationId);
        console.log('清理流式请求资源完成');
      }
    } else {
      // 非流式响应请求
      console.log('发送非流式请求:', {
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
        let errorBody = `服务器错误: ${response.status}`;
        try {
            const errorData = await response.json();
            errorBody = errorData.error || errorBody;
        } catch (e) { /* 忽略解析错误 */ }
        throw new Error(errorBody);
      }
      
      const data = await response.json();
      console.log('收到非流式响应:', {
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
      console.log('请求已中止');
    } else {
      console.error('发送聊天消息时出错:', error);
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