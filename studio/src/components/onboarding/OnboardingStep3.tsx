import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, Info } from "lucide-react";

interface OnboardingStep3Props {
  onNext: (password: string) => void;
  onBack: () => void;
}

const OnboardingStep3: React.FC<OnboardingStep3Props> = ({ onNext, onBack }) => {
  const { t } = useTranslation('onboarding');
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const isValid = password.length >= 8 && password === confirmPassword;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    // Just pass the password to the next step - actual configuration happens during deployment
    onNext(password);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative bg-white">
      {/* Subtle gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-white to-indigo-50/30" />

      {/* Decorative gradient orbs */}
      <div className="absolute top-1/4 -left-32 w-96 h-96 bg-gradient-to-r from-purple-200/30 to-pink-200/30 rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-gradient-to-r from-blue-200/30 to-indigo-200/30 rounded-full blur-3xl" />

      <div className="max-w-2xl w-full bg-white/80 backdrop-blur-xl rounded-3xl shadow-xl overflow-hidden relative z-10 border border-gray-200">
        <div className="p-8">
          <div className="mb-8">
            <div className="text-sm text-gray-500 mb-2">
              {t('step3.stepIndicator')}
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              {t('step3.title')}
            </h1>
            <p className="text-gray-600">
              {t('step3.description')}
            </p>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="bg-gray-50 rounded-xl p-6 mb-6 border border-gray-200">
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('step3.adminPasswordLabel')}
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white text-gray-900 placeholder-gray-400 pr-20"
                    placeholder={t('step3.passwordPlaceholder')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('step3.confirmPasswordLabel')}
                </label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white text-gray-900 placeholder-gray-400 pr-20"
                    placeholder={t('step3.passwordPlaceholder')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2 text-sm">
                <div
                  className={`flex items-center ${
                    password.length >= 8
                      ? "text-green-600"
                      : "text-gray-400"
                  }`}
                >
                  <span className="mr-2">{password.length >= 8 ? "✓" : "○"}</span>
                  {t('step3.minLength')}
                </div>
                <div
                  className={`flex items-center ${
                    password === confirmPassword && confirmPassword.length > 0
                      ? "text-green-600"
                      : "text-gray-400"
                  }`}
                >
                  <span className="mr-2">
                    {password === confirmPassword && confirmPassword.length > 0
                      ? "✓"
                      : "○"}
                  </span>
                  {t('step3.passwordMatch')}
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2 text-sm text-gray-500 mb-6">
              <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <p>{t('step3.hint')}</p>
            </div>

            <div className="flex justify-between">
              <button
                type="button"
                onClick={onBack}
                className="px-6 py-2 text-gray-500 hover:text-gray-700 transition-colors"
              >
                {t('step3.backButton')}
              </button>
              <button
                type="submit"
                disabled={!isValid}
                className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              >
                {t('step3.continueButton')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default OnboardingStep3;
