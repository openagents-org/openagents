/**
 * Exit button for onboarding wizard with confirmation
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface ExitButtonProps {
  onSkip: () => void;
}

const ExitButton: React.FC<ExitButtonProps> = ({ onSkip }) => {
  const [showConfirm, setShowConfirm] = useState(false);
  const navigate = useNavigate();

  const handleExit = () => {
    onSkip();
    navigate('/profile');
  };

  return (
    <>
      <button
        onClick={() => setShowConfirm(true)}
        className="text-gray-500 hover:text-gray-700 font-medium transition-colors"
      >
        Skip Wizard
      </button>

      {/* Confirmation Modal */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md mx-4 shadow-xl">
            <h3 className="text-xl font-semibold mb-4">Exit Setup Wizard?</h3>
            <p className="text-gray-600 mb-6">
              You can return to this wizard anytime from the help menu or by
              visiting the onboarding page.
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleExit}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
              >
                Exit to Studio
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ExitButton;
