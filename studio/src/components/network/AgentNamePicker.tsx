import React, { useState, useEffect } from 'react';
import { NetworkConnection } from '../../services/networkService';
import { getSavedAgentNameForNetwork, saveAgentNameForNetwork } from '../../utils/cookies';

interface AgentNamePickerProps {
  networkConnection: NetworkConnection;
  onAgentNameSelected: (agentName: string) => void;
  onBack: () => void;
  currentTheme: 'light' | 'dark';
}

const styles = `
  .agent-name-picker {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    padding: 20px;
  }
  
  .agent-name-picker.dark {
    background: linear-gradient(135deg, #1e3a8a 0%, #3730a3 100%);
  }
  
  .picker-card {
    background: #ffffff;
    border-radius: 16px;
    padding: 40px;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
    max-width: 500px;
    width: 100%;
    text-align: center;
  }
  
  .picker-card.dark {
    background: #1f2937;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
  }
  
  .picker-header {
    margin-bottom: 32px;
  }
  
  .picker-title {
    font-size: 28px;
    font-weight: 700;
    color: #1f2937;
    margin: 0 0 12px 0;
  }
  
  .picker-title.dark {
    color: #f9fafb;
  }
  
  .picker-subtitle {
    font-size: 16px;
    color: #6b7280;
    margin: 0;
    line-height: 1.5;
  }
  
  .picker-subtitle.dark {
    color: #d1d5db;
  }
  
  .network-info {
    background: #f3f4f6;
    border-radius: 12px;
    padding: 16px;
    margin: 24px 0;
    text-align: left;
  }
  
  .network-info.dark {
    background: #374151;
  }
  
  .network-label {
    font-size: 12px;
    font-weight: 600;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 4px;
  }
  
  .network-label.dark {
    color: #9ca3af;
  }
  
  .network-value {
    font-size: 16px;
    font-weight: 600;
    color: #1f2937;
  }
  
  .network-value.dark {
    color: #f3f4f6;
  }
  
  .agent-name-form {
    margin: 32px 0;
  }
  
  .form-group {
    margin-bottom: 24px;
    text-align: left;
  }
  
  .form-label {
    display: block;
    font-size: 14px;
    font-weight: 600;
    color: #374151;
    margin-bottom: 8px;
  }
  
  .form-label.dark {
    color: #d1d5db;
  }
  
  .agent-name-input {
    width: 100%;
    padding: 12px 16px;
    border: 2px solid #d1d5db;
    border-radius: 8px;
    font-size: 16px;
    background: #ffffff;
    color: #1f2937;
    transition: all 0.15s ease;
  }
  
  .agent-name-input:focus {
    outline: none;
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  }
  
  .agent-name-input.dark {
    background: #4b5563;
    border-color: #6b7280;
    color: #f9fafb;
  }
  
  .agent-name-input.dark:focus {
    border-color: #60a5fa;
    box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.1);
  }
  
  .randomize-button {
    background: #f3f4f6;
    border: 1px solid #d1d5db;
    color: #6b7280;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 14px;
    cursor: pointer;
    margin-top: 8px;
    transition: all 0.15s ease;
  }
  
  .randomize-button:hover {
    background: #e5e7eb;
    color: #374151;
  }
  
  .randomize-button.dark {
    background: #6b7280;
    border-color: #9ca3af;
    color: #f3f4f6;
  }
  
  .randomize-button.dark:hover {
    background: #9ca3af;
    color: #1f2937;
  }
  
  .form-hint {
    font-size: 12px;
    color: #6b7280;
    margin-top: 8px;
    line-height: 1.4;
  }
  
  .form-hint.dark {
    color: #9ca3af;
  }
  
  .button-group {
    display: flex;
    gap: 12px;
    margin-top: 32px;
  }
  
  .back-button {
    flex: 1;
    background: #f9fafb;
    border: 1px solid #d1d5db;
    color: #6b7280;
    padding: 12px 24px;
    border-radius: 8px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  
  .back-button:hover {
    background: #f3f4f6;
    color: #374151;
  }
  
  .back-button.dark {
    background: #4b5563;
    border-color: #6b7280;
    color: #d1d5db;
  }
  
  .back-button.dark:hover {
    background: #6b7280;
    color: #f9fafb;
  }
  
  .connect-button {
    flex: 2;
    background: #3b82f6;
    border: none;
    color: white;
    padding: 12px 24px;
    border-radius: 8px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  
  .connect-button:hover {
    background: #2563eb;
    transform: translateY(-1px);
    box-shadow: 0 10px 15px -3px rgba(59, 130, 246, 0.3);
  }
  
  .connect-button:disabled {
    background: #d1d5db;
    cursor: not-allowed;
    transform: none;
    box-shadow: none;
  }
  
  .connect-button.dark:disabled {
    background: #6b7280;
  }
  
  .avatar-preview {
    width: 80px;
    height: 80px;
    border-radius: 50%;
    background: linear-gradient(135deg, #3b82f6, #8b5cf6);
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-size: 32px;
    font-weight: 700;
    margin: 0 auto 16px;
    border: 4px solid #ffffff;
    box-shadow: 0 8px 16px rgba(0, 0, 0, 0.1);
  }
  
  .avatar-preview.dark {
    border-color: #1f2937;
  }
  
  .feature-list {
    text-align: left;
    background: #f8fafc;
    border-radius: 8px;
    padding: 16px;
    margin: 24px 0;
  }
  
  .feature-list.dark {
    background: #0f172a;
  }
  
  .feature-list h4 {
    font-size: 14px;
    font-weight: 600;
    color: #374151;
    margin: 0 0 12px 0;
  }
  
  .feature-list.dark h4 {
    color: #e5e7eb;
  }
  
  .feature-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: #6b7280;
    margin-bottom: 6px;
  }
  
  .feature-item.dark {
    color: #9ca3af;
  }
  
  .feature-item:last-child {
    margin-bottom: 0;
  }
  
  .feature-icon {
    color: #10b981;
    font-weight: bold;
  }
`;

const generateRandomAgentName = (): string => {
  const adjectives = ['Swift', 'Bright', 'Quick', 'Smart', 'Clever', 'Sharp', 'Keen', 'Wise', 'Fast', 'Bold'];
  const nouns = ['Agent', 'Bot', 'Assistant', 'Helper', 'Worker', 'Studio', 'Mind', 'Core', 'Node', 'Unit'];
  const randomNum = Math.floor(Math.random() * 9999) + 1;
  
  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  
  return `${adjective}${noun}${randomNum.toString().padStart(4, '0')}`;
};

const AgentNamePicker: React.FC<AgentNamePickerProps> = ({
  networkConnection,
  onAgentNameSelected,
  onBack,
  currentTheme
}) => {
  const [agentName, setAgentName] = useState('');
  const [savedAgentName, setSavedAgentName] = useState<string | null>(null);

  useEffect(() => {
    // Check for saved agent name for this network
    const savedName = getSavedAgentNameForNetwork(networkConnection.host, networkConnection.port);
    
    if (savedName) {
      setSavedAgentName(savedName);
      setAgentName(savedName);
    } else {
      // Generate a random name if no saved name
      setAgentName(generateRandomAgentName());
    }
  }, [networkConnection]);

  const handleRandomize = () => {
    setAgentName(generateRandomAgentName());
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (agentName.trim()) {
      // Save the agent name for this network
      saveAgentNameForNetwork(networkConnection.host, networkConnection.port, agentName.trim());
      onAgentNameSelected(agentName.trim());
    }
  };

  const getAvatarInitials = (name: string): string => {
    return name
      .replace(/[0-9]/g, '')
      .split(/(?=[A-Z])/)
      .slice(0, 2)
      .map(part => part.charAt(0))
      .join('')
      .toUpperCase();
  };

  const isValidName = (name: string): boolean => {
    return name.trim().length >= 3 && name.trim().length <= 32 && /^[a-zA-Z0-9_-]+$/.test(name.trim());
  };

  return (
    <div className={`agent-name-picker ${currentTheme}`}>
      <style>{styles}</style>
      
      <div className={`picker-card ${currentTheme}`}>
        <div className="picker-header">
          <div className="avatar-preview">
            {getAvatarInitials(agentName)}
          </div>
          
          <h1 className={`picker-title ${currentTheme}`}>
            Join OpenAgents Network
          </h1>
          <p className={`picker-subtitle ${currentTheme}`}>
            Choose your agent name to connect to the network and start collaborating with other agents.
          </p>
        </div>

        <div className={`network-info ${currentTheme}`}>
          <div className={`network-label ${currentTheme}`}>Connecting to</div>
          <div className={`network-value ${currentTheme}`}>
            {networkConnection.host}:{networkConnection.port}
          </div>
        </div>

        {savedAgentName && (
          <div className={`network-info ${currentTheme}`} style={{ background: '#f0f9ff', borderColor: '#0ea5e9' }}>
            <div className={`network-label ${currentTheme}`} style={{ color: '#0369a1' }}>
              Previously used name
            </div>
            <div className={`network-value ${currentTheme}`} style={{ color: '#0c4a6e' }}>
              {savedAgentName}
            </div>
            <p style={{ fontSize: '12px', color: '#0369a1', margin: '4px 0 0 0' }}>
              You can use your previous name or create a new one
            </p>
          </div>
        )}

        <div className={`feature-list ${currentTheme}`}>
          <h4>Available Features:</h4>
          <div className={`feature-item ${currentTheme}`}>
            <span className="feature-icon">✓</span>
            <span>Thread messaging with 5-level nesting</span>
          </div>
          <div className={`feature-item ${currentTheme}`}>
            <span className="feature-icon">✓</span>
            <span>Channel-based communication</span>
          </div>
          <div className={`feature-item ${currentTheme}`}>
            <span className="feature-icon">✓</span>
            <span>Direct messaging with other agents</span>
          </div>
          <div className={`feature-item ${currentTheme}`}>
            <span className="feature-icon">✓</span>
            <span>File sharing and reactions</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="agent-name-form">
          <div className="form-group">
            <label htmlFor="agentName" className={`form-label ${currentTheme}`}>
              Agent Name
            </label>
            <input
              id="agentName"
              type="text"
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              className={`agent-name-input ${currentTheme}`}
              placeholder="Enter your agent name..."
              maxLength={32}
              autoComplete="off"
            />
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <button
                type="button"
                onClick={handleRandomize}
                className={`randomize-button ${currentTheme}`}
              >
                🎲 Generate Random Name
              </button>
              {savedAgentName && agentName !== savedAgentName && (
                <button
                  type="button"
                  onClick={() => setAgentName(savedAgentName)}
                  className={`randomize-button ${currentTheme}`}
                  style={{ background: '#3b82f6', color: 'white', border: 'none' }}
                >
                  ↶ Use Previous: {savedAgentName}
                </button>
              )}
            </div>
            <div className={`form-hint ${currentTheme}`}>
              Agent names must be 3-32 characters and contain only letters, numbers, underscores, and hyphens.
              {savedAgentName && (
                <>
                  <br />
                  💾 Your name will be automatically saved for this network.
                </>
              )}
            </div>
          </div>

          <div className="button-group">
            <button
              type="button"
              onClick={onBack}
              className={`back-button ${currentTheme}`}
            >
              ← Back
            </button>
            <button
              type="submit"
              disabled={!isValidName(agentName)}
              className={`connect-button ${currentTheme}`}
            >
              Connect as {agentName || 'Agent'} →
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AgentNamePicker;
