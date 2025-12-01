import React, { useState, useEffect } from 'react';
import { useOpenAgents } from '@/context/OpenAgentsProvider';
import { profileSelectors } from '@/stores/profileStore';
import { useAuthStore } from '@/stores/authStore';

interface NetworkProfileData {
  discoverable: boolean;
  name: string;
  description: string;
  icon: string;
  website: string;
  tags: string[];
  categories: string[];
  country: string;
  required_openagents_version: string;
  capacity: number;
  host: string;
  port: number;
}

const NetworkProfile: React.FC = () => {
  const { connector } = useOpenAgents();
  const { agentName } = useAuthStore();
  const healthData = profileSelectors.useHealthData();
  
  // Get default port from HTTP transport if available
  const getDefaultPort = (): number => {
    if (healthData?.data?.transports) {
      const httpTransport = healthData.data.transports.find(
        (t: any) => t.type === 'http'
      );
      return httpTransport?.port || 8700;
    }
    return 8700;
  };

  const [formData, setFormData] = useState<NetworkProfileData>({
    discoverable: true,
    name: '',
    description: '',
    icon: '',
    website: '',
    tags: [],
    categories: [],
    country: 'Worldwide',
    required_openagents_version: '0.5.1',
    capacity: 100,
    host: '0.0.0.0',
    port: getDefaultPort(),
  });

  const [tagInput, setTagInput] = useState('');
  const [categoryInput, setCategoryInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Load existing network profile data
  useEffect(() => {
    const loadProfileData = async () => {
      if (!connector) return;

      try {
        setIsLoading(true);
        setError(null);

        // Call /api/health to get network profile data
        console.log('📡 Fetching network profile from /api/health...');
        const healthResponse = await connector.getNetworkHealth();
        console.log('📡 Health response:', healthResponse);

        // Try different possible field names for profile
        const profile = healthResponse?.data?.network_profile;

        if (profile) {
          console.log('✅ Found profile data:', profile);
          setFormData(prev => ({
            ...prev,
            discoverable: profile.discoverable ?? prev.discoverable,
            name: profile.name || prev.name,
            description: profile.description || prev.description,
            icon: profile.icon || prev.icon,
            website: profile.website || prev.website,
            tags: Array.isArray(profile.tags) ? profile.tags : prev.tags,
            categories: Array.isArray(profile.categories) ? profile.categories : prev.categories,
            country: profile.country || prev.country,
            required_openagents_version: profile.required_openagents_version || prev.required_openagents_version,
            capacity: profile.capacity ?? prev.capacity,
            host: profile.host || prev.host,
            port: profile.port ?? prev.port,
          }));
        } else {
        }
      } catch (err) {
        console.error('Failed to load network profile:', err);
        setError('Failed to load network profile data');
      } finally {
        setIsLoading(false);
      }
    };

    loadProfileData();
  }, [connector]);

  const handleInputChange = (
    field: keyof NetworkProfileData,
    value: any
  ) => {
    setFormData(prev => ({
      ...prev,
      [field]: value,
    }));
    setError(null);
    setSuccess(null);
  };

  const handleAddTag = () => {
    if (tagInput.trim() && !formData.tags.includes(tagInput.trim())) {
      handleInputChange('tags', [...formData.tags, tagInput.trim()]);
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    handleInputChange(
      'tags',
      formData.tags.filter(tag => tag !== tagToRemove)
    );
  };

  const handleAddCategory = () => {
    if (categoryInput.trim() && !formData.categories.includes(categoryInput.trim())) {
      handleInputChange('categories', [...formData.categories, categoryInput.trim()]);
      setCategoryInput('');
    }
  };

  const handleRemoveCategory = (categoryToRemove: string) => {
    handleInputChange(
      'categories',
      formData.categories.filter(cat => cat !== categoryToRemove)
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!connector) {
      setError('Not connected to network');
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      console.log('📝 Sending network profile update:', formData);

      // Prepare profile payload according to NetworkProfilePatch model
      // All fields are Optional, but we send all current values
      // Empty strings for optional URL fields (icon, website) should be omitted or null
      const profilePayload: any = {
        discoverable: formData.discoverable,
        name: formData.name.trim(),
        description: formData.description.trim(),
        country: formData.country.trim(),
        required_openagents_version: formData.required_openagents_version.trim(),
        capacity: formData.capacity,
        host: formData.host.trim(),
        port: formData.port,
        tags: formData.tags,
        categories: formData.categories,
      };

      // Only include icon/website if they have non-empty values
      if (formData.icon.trim()) {
        profilePayload.icon = formData.icon.trim();
      }
      if (formData.website.trim()) {
        profilePayload.website = formData.website.trim();
      }

      // Send system.update_network_profile event
      // Payload structure: { agent_id: string, profile: {...} }
      const response = await connector.sendEvent({
        event_name: "system.update_network_profile",
        source_id: agentName || "system",
        payload: {
          agent_id: agentName || "system",
          profile: profilePayload,
        },
      });

      if (response.success) {
        console.log('✅ Network profile updated successfully');
        setSuccess('Network profile updated successfully!');
        // Reload profile data after successful update
        setTimeout(async () => {
          try {
            const healthResponse = await connector.getNetworkHealth();
            const profile = healthResponse?.network_profile;
            if (profile) {
              setFormData(prev => ({
                ...prev,
                discoverable: profile.discoverable ?? prev.discoverable,
                name: profile.name || prev.name,
                description: profile.description || prev.description,
                icon: profile.icon || prev.icon,
                website: profile.website || prev.website,
                tags: Array.isArray(profile.tags) ? profile.tags : prev.tags,
                categories: Array.isArray(profile.categories) ? profile.categories : prev.categories,
                country: profile.country || prev.country,
                required_openagents_version: profile.required_openagents_version || prev.required_openagents_version,
                capacity: profile.capacity ?? prev.capacity,
                host: profile.host || prev.host,
                port: profile.port ?? prev.port,
              }));
            }
          } catch (err) {
            console.error('Failed to reload profile after update:', err);
          }
        }, 500);
      } else {
        console.error('❌ Failed to update network profile:', response.message);
        setError(response.message || 'Failed to update network profile');
      }
    } catch (err: any) {
      console.error('Failed to save network profile:', err);
      setError(err.message || 'Failed to save network profile');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 dark:bg-gray-900 h-full">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="ml-3 text-gray-600 dark:text-gray-400">
            Loading network profile...
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 dark:bg-gray-900 h-full min-h-screen overflow-y-auto">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            Network Profile
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Configure your network profile settings
          </p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <button
            type="button"
            onClick={() => window.history.back()}
            className="px-6 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="network-profile-form"
            disabled={isSaving || !formData.name || !formData.description}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Error/Success Messages */}
      {error && (
        <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex items-center">
            <svg className="h-5 w-5 text-red-400 mr-2" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <span className="text-sm text-red-800 dark:text-red-200">{error}</span>
          </div>
        </div>
      )}

      {success && (
        <div className="mb-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
          <div className="flex items-center">
            <svg className="h-5 w-5 text-green-400 mr-2" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <span className="text-sm text-green-800 dark:text-green-200">{success}</span>
          </div>
        </div>
      )}

      {/* Form */}
      <form id="network-profile-form" onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          {/* Basic Information Section */}
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 pb-2 border-b border-gray-200 dark:border-gray-700">
            Basic Information
          </h2>

          <div className="space-y-4">
            {/* Discoverable */}
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Discoverable
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Allow this network to be discovered publicly
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.discoverable}
                  onChange={(e) => handleInputChange('discoverable', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
              </label>
            </div>

            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Network Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => handleInputChange('name', e.target.value)}
                className="w-full p-3 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Work Test Workspace"
                required
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Description <span className="text-red-500">*</span>
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => handleInputChange('description', e.target.value)}
                rows={4}
                className="w-full p-3 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                placeholder="A test workspace for collaborative work and productivity features..."
                required
              />
            </div>

            {/* Icon */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Icon URL
              </label>
              <input
                type="url"
                value={formData.icon}
                onChange={(e) => handleInputChange('icon', e.target.value)}
                className="w-full p-3 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="https://openagents.org/icons/work-test.png"
              />
              {formData.icon && (
                <div className="mt-2">
                  <img
                    src={formData.icon}
                    alt="Network icon"
                    className="h-16 w-16 rounded object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                </div>
              )}
            </div>

            {/* Website */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Website URL
              </label>
              <input
                type="url"
                value={formData.website}
                onChange={(e) => handleInputChange('website', e.target.value)}
                className="w-full p-3 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="https://openagents.org"
              />
            </div>

            {/* Country */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Country
              </label>
              <input
                type="text"
                value={formData.country}
                onChange={(e) => handleInputChange('country', e.target.value)}
                className="w-full p-3 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Worldwide"
              />
            </div>
          </div>
        </div>

        {/* Tags Section */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 pb-2 border-b border-gray-200 dark:border-gray-700">
            Tags
          </h2>
          
          <div className="space-y-4">
            {/* Tag Input */}
            <div className="flex gap-2">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
                className="flex-1 p-3 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Enter a tag and press Enter"
              />
              <button
                type="button"
                onClick={handleAddTag}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
              >
                Add
              </button>
            </div>

            {/* Tags List */}
            {formData.tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {formData.tags.map((tag, index) => (
                  <span
                    key={index}
                    className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      className="ml-2 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Categories Section */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 pb-2 border-b border-gray-200 dark:border-gray-700">
            Categories
          </h2>
          
          <div className="space-y-4">
            {/* Category Input */}
            <div className="flex gap-2">
              <input
                type="text"
                value={categoryInput}
                onChange={(e) => setCategoryInput(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddCategory();
                  }
                }}
                className="flex-1 p-3 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Enter a category and press Enter"
              />
              <button
                type="button"
                onClick={handleAddCategory}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
              >
                Add
              </button>
            </div>

            {/* Categories List */}
            {formData.categories.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {formData.categories.map((category, index) => (
                  <span
                    key={index}
                    className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200"
                  >
                    {category}
                    <button
                      type="button"
                      onClick={() => handleRemoveCategory(category)}
                      className="ml-2 text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-200"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Technical Settings Section */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 pb-2 border-b border-gray-200 dark:border-gray-700">
            Technical Settings
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Required OpenAgents Version */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Required OpenAgents Version
              </label>
              <input
                type="text"
                value={formData.required_openagents_version}
                onChange={(e) => handleInputChange('required_openagents_version', e.target.value)}
                className="w-full p-3 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="0.5.1"
              />
            </div>

            {/* Capacity */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Capacity
              </label>
              <input
                type="number"
                value={formData.capacity}
                onChange={(e) => handleInputChange('capacity', parseInt(e.target.value) || 0)}
                min="1"
                className="w-full p-3 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="100"
              />
            </div>

            {/* Host */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Host
              </label>
              <input
                type="text"
                value={formData.host}
                onChange={(e) => handleInputChange('host', e.target.value)}
                className="w-full p-3 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="0.0.0.0"
              />
            </div>

            {/* Port */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Port <span className="text-xs text-gray-500">(HTTP Transport)</span>
              </label>
              <input
                type="number"
                value={formData.port}
                onChange={(e) => handleInputChange('port', parseInt(e.target.value) || 0)}
                min="1"
                max="65535"
                className="w-full p-3 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="8700"
              />
            </div>
          </div>
        </div>
      </form>
    </div>
  );
};

export default NetworkProfile;
