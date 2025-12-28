import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useOpenAgents } from '@/context/OpenAgentsProvider';
import { profileSelectors } from '@/stores/profileStore';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/layout/ui/button';
import { Input } from '@/components/layout/ui/input';
import { Textarea } from '@/components/layout/ui/textarea';
import { Badge } from '@/components/layout/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/layout/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/layout/ui/command';
import { AlertCircle, CheckCircle2, X, Upload, Loader2, ChevronsUpDown, Check } from 'lucide-react';
import { uploadNetworkIcon } from '@/services/networkService';
import { cn } from '@/lib/utils';

// List of countries for the country selector
const COUNTRIES = [
  'Worldwide',
  'Afghanistan',
  'Albania',
  'Algeria',
  'Andorra',
  'Angola',
  'Antigua and Barbuda',
  'Argentina',
  'Armenia',
  'Australia',
  'Austria',
  'Azerbaijan',
  'Bahamas',
  'Bahrain',
  'Bangladesh',
  'Barbados',
  'Belarus',
  'Belgium',
  'Belize',
  'Benin',
  'Bhutan',
  'Bolivia',
  'Bosnia and Herzegovina',
  'Botswana',
  'Brazil',
  'Brunei',
  'Bulgaria',
  'Burkina Faso',
  'Burundi',
  'Cabo Verde',
  'Cambodia',
  'Cameroon',
  'Canada',
  'Central African Republic',
  'Chad',
  'Chile',
  'China',
  'Colombia',
  'Comoros',
  'Congo',
  'Costa Rica',
  'Croatia',
  'Cuba',
  'Cyprus',
  'Czech Republic',
  'Denmark',
  'Djibouti',
  'Dominica',
  'Dominican Republic',
  'East Timor',
  'Ecuador',
  'Egypt',
  'El Salvador',
  'Equatorial Guinea',
  'Eritrea',
  'Estonia',
  'Eswatini',
  'Ethiopia',
  'Fiji',
  'Finland',
  'France',
  'Gabon',
  'Gambia',
  'Georgia',
  'Germany',
  'Ghana',
  'Greece',
  'Grenada',
  'Guatemala',
  'Guinea',
  'Guinea-Bissau',
  'Guyana',
  'Haiti',
  'Honduras',
  'Hungary',
  'Iceland',
  'India',
  'Indonesia',
  'Iran',
  'Iraq',
  'Ireland',
  'Israel',
  'Italy',
  'Ivory Coast',
  'Jamaica',
  'Japan',
  'Jordan',
  'Kazakhstan',
  'Kenya',
  'Kiribati',
  'Kosovo',
  'Kuwait',
  'Kyrgyzstan',
  'Laos',
  'Latvia',
  'Lebanon',
  'Lesotho',
  'Liberia',
  'Libya',
  'Liechtenstein',
  'Lithuania',
  'Luxembourg',
  'Madagascar',
  'Malawi',
  'Malaysia',
  'Maldives',
  'Mali',
  'Malta',
  'Marshall Islands',
  'Mauritania',
  'Mauritius',
  'Mexico',
  'Micronesia',
  'Moldova',
  'Monaco',
  'Mongolia',
  'Montenegro',
  'Morocco',
  'Mozambique',
  'Myanmar',
  'Namibia',
  'Nauru',
  'Nepal',
  'Netherlands',
  'New Zealand',
  'Nicaragua',
  'Niger',
  'Nigeria',
  'North Korea',
  'North Macedonia',
  'Norway',
  'Oman',
  'Pakistan',
  'Palau',
  'Palestine',
  'Panama',
  'Papua New Guinea',
  'Paraguay',
  'Peru',
  'Philippines',
  'Poland',
  'Portugal',
  'Qatar',
  'Romania',
  'Russia',
  'Rwanda',
  'Saint Kitts and Nevis',
  'Saint Lucia',
  'Saint Vincent and the Grenadines',
  'Samoa',
  'San Marino',
  'Sao Tome and Principe',
  'Saudi Arabia',
  'Senegal',
  'Serbia',
  'Seychelles',
  'Sierra Leone',
  'Singapore',
  'Slovakia',
  'Slovenia',
  'Solomon Islands',
  'Somalia',
  'South Africa',
  'South Korea',
  'South Sudan',
  'Spain',
  'Sri Lanka',
  'Sudan',
  'Suriname',
  'Sweden',
  'Switzerland',
  'Syria',
  'Taiwan',
  'Tajikistan',
  'Tanzania',
  'Thailand',
  'Togo',
  'Tonga',
  'Trinidad and Tobago',
  'Tunisia',
  'Turkey',
  'Turkmenistan',
  'Tuvalu',
  'Uganda',
  'Ukraine',
  'United Arab Emirates',
  'United Kingdom',
  'United States',
  'Uruguay',
  'Uzbekistan',
  'Vanuatu',
  'Vatican City',
  'Venezuela',
  'Vietnam',
  'Yemen',
  'Zambia',
  'Zimbabwe',
];

interface NetworkProfileData {
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
  const { t } = useTranslation('network');
  const { connector } = useOpenAgents();
  const { agentName, selectedNetwork } = useAuthStore();
  const healthData = profileSelectors.useHealthData();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Get default port from HTTP transport if available
  const getDefaultPort = (): number => {
    // healthData from store is HealthResponse type with .data wrapper
    if (healthData?.data?.transports) {
      const httpTransport = healthData.data.transports.find(
        (t: any) => t.type === 'http'
      );
      return httpTransport?.config?.port || httpTransport?.port || 8700;
    }
    return 8700;
  };

  const [formData, setFormData] = useState<NetworkProfileData>({
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
  const [isUploadingIcon, setIsUploadingIcon] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [countryOpen, setCountryOpen] = useState(false);

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

        // getNetworkHealth() already returns response.data, so no extra .data needed
        const profile = healthResponse?.network_profile;

        if (profile) {
          console.log('✅ Found profile data:', profile);
          setFormData(prev => ({
            ...prev,
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

  // Handle icon file upload
  const handleIconUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setError('Image file must be less than 5MB');
      return;
    }

    if (!selectedNetwork) {
      setError('No network connection available');
      return;
    }

    try {
      setIsUploadingIcon(true);
      setError(null);

      const result = await uploadNetworkIcon(selectedNetwork, file);

      if (result.success && result.url) {
        handleInputChange('icon', result.url);
        setSuccess('Icon uploaded successfully');
      } else {
        setError(result.error || 'Failed to upload icon');
      }
    } catch (err: any) {
      console.error('Failed to upload icon:', err);
      setError(err.message || 'Failed to upload icon');
    } finally {
      setIsUploadingIcon(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
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
        setSuccess(t('profile.success'));
        // Reload profile data after successful update
        setTimeout(async () => {
          try {
            const healthResponse = await connector.getNetworkHealth();
            const profile = healthResponse?.network_profile;
            if (profile) {
              setFormData(prev => ({
                ...prev,
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
        setError(response.message || t('profile.error'));
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
      <div className="p-6 dark:bg-gray-800 h-full">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="ml-3 text-gray-600 dark:text-gray-400">
            {t('status.connecting')}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 dark:bg-gray-800 h-full min-h-screen overflow-y-auto">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            {t('profile.title')}
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            {t('profile.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <Button
            type="button"
            onClick={() => window.history.back()}
            variant="outline"
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            {t('profile.cancel')}
          </Button>
          <Button
            type="submit"
            form="network-profile-form"
            disabled={isSaving || !formData.name || !formData.description}
            variant="primary"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSaving ? t('profile.saving') : t('profile.save')}
          </Button>
        </div>
      </div>

      {/* Error/Success Messages */}
      {error && (
        <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex items-center">
            <AlertCircle className="h-5 w-5 text-red-400 mr-2" />
            <span className="text-sm text-red-800 dark:text-red-200">{error}</span>
          </div>
        </div>
      )}

      {success && (
        <div className="mb-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
          <div className="flex items-center">
            <CheckCircle2 className="h-5 w-5 text-green-400 mr-2" />
            <span className="text-sm text-green-800 dark:text-green-200">{success}</span>
          </div>
        </div>
      )}

      {/* Form */}
      <form id="network-profile-form" onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
          {/* Basic Information Section */}
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 pb-2 border-b border-gray-200 dark:border-gray-700">
            {t('profile.basicInfo')}
          </h2>

          <div className="space-y-6">
            {/* Name */}
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-gray-900 dark:text-gray-100">
                {t('profile.name')} <span className="text-red-500 font-medium">*</span>
              </label>
              <Input
                type="text"
                variant="lg"
                value={formData.name}
                onChange={(e) => handleInputChange('name', e.target.value)}
                className="w-full p-3 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Work Test Workspace"
                required
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-gray-900 dark:text-gray-100">
                {t('profile.description')} <span className="text-red-500 font-medium">*</span>
              </label>
              <Textarea
                variant="lg"
                value={formData.description}
                onChange={(e) => handleInputChange('description', e.target.value)}
                rows={4}
                className="w-full p-3 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                placeholder="A test workspace for collaborative work and productivity features..."
                required
              />
            </div>

            {/* Icon */}
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-gray-900 dark:text-gray-100">
                {t('profile.icon')}
              </label>
              <div className="flex gap-3">
                <Input
                  type="url"
                  variant="lg"
                  value={formData.icon}
                  onChange={(e) => handleInputChange('icon', e.target.value)}
                  className="flex-1 p-3 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="https://openagents.org/icons/work-test.png"
                />
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleIconUpload}
                  accept="image/*"
                  className="hidden"
                />
                <Button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploadingIcon}
                  variant="outline"
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  {isUploadingIcon ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {t('profile.uploading')}
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4 mr-2" />
                      {t('profile.upload')}
                    </>
                  )}
                </Button>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t('profile.iconHint')}
              </p>
              {formData.icon && (
                <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700 inline-block">
                  <img
                    src={formData.icon}
                    alt="Network icon"
                    className="h-20 w-20 rounded-lg object-cover shadow-sm"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                </div>
              )}
            </div>

            {/* Website */}
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-gray-900 dark:text-gray-100">
                {t('profile.website')}
              </label>
              <Input
                type="url"
                variant="lg"
                value={formData.website}
                onChange={(e) => handleInputChange('website', e.target.value)}
                className="w-full p-3 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="https://openagents.org"
              />
            </div>

            {/* Country */}
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-gray-900 dark:text-gray-100">
                {t('profile.country')}
              </label>
              <Popover open={countryOpen} onOpenChange={setCountryOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={countryOpen}
                    className="w-full p-3 h-auto justify-between rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-normal"
                  >
                    {formData.country || t('profile.selectCountry')}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0" align="start">
                  <Command>
                    <CommandInput placeholder={t('profile.searchCountry')} />
                    <CommandList>
                      <CommandEmpty>{t('profile.noCountryFound')}</CommandEmpty>
                      <CommandGroup>
                        {COUNTRIES.map((country) => (
                          <CommandItem
                            key={country}
                            value={country}
                            onSelect={(currentValue) => {
                              // cmdk normalizes values to lowercase, so we need to find the original country
                              const selectedCountry = COUNTRIES.find(
                                c => c.toLowerCase() === currentValue.toLowerCase()
                              ) || currentValue;
                              handleInputChange('country', selectedCountry === formData.country ? '' : selectedCountry);
                              setCountryOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                'mr-2 h-4 w-4',
                                formData.country === country ? 'opacity-100' : 'opacity-0'
                              )}
                            />
                            {country}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>

        {/* Tags Section */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 pb-2 border-b border-gray-200 dark:border-gray-700">
            {t('profile.tags.title')}
          </h2>

          <div className="space-y-4">
            {/* Tag Input */}
            <div className="flex gap-3">
              <Input
                type="text"
                variant="lg"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
                className="flex-1 p-3 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder={t('profile.tags.placeholder')}
              />
              <Button
                type="button"
                onClick={handleAddTag}
                variant="primary"
                size="lg"
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {t('profile.tags.add')}
              </Button>
            </div>

            {/* Tags List */}
            {formData.tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {formData.tags.map((tag, index) => (
                  <Badge
                    key={index}
                    variant="primary"
                    appearance="light"
                    size="md"
                    className="inline-flex items-center gap-1"
                  >
                    {tag}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveTag(tag)}
                      className="ml-2 h-auto w-auto p-0 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Categories Section */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 pb-2 border-b border-gray-200 dark:border-gray-700">
            {t('profile.categories.title')}
          </h2>

          <div className="space-y-4">
            {/* Category Input */}
            <div className="flex gap-3">
              <Input
                type="text"
                variant="lg"
                value={categoryInput}
                onChange={(e) => setCategoryInput(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddCategory();
                  }
                }}
                className="flex-1 p-3 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder={t('profile.categories.placeholder')}
              />
              <Button
                type="button"
                onClick={handleAddCategory}
                variant="primary"
                size="lg"
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {t('profile.categories.add')}
              </Button>
            </div>

            {/* Categories List */}
            {formData.categories.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {formData.categories.map((category, index) => (
                  <Badge
                    key={index}
                    variant="info"
                    appearance="light"
                    size="md"
                    className="inline-flex items-center gap-1"
                  >
                    {category}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveCategory(category)}
                      className="ml-2 h-auto w-auto p-0 text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-200"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Technical Settings Section */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 pb-2 border-b border-gray-200 dark:border-gray-700">
            {t('profile.technical')}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Required OpenAgents Version */}
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-gray-900 dark:text-gray-100">
                {t('profile.version')}
              </label>
              <Input
                type="text"
                variant="lg"
                value={formData.required_openagents_version}
                onChange={(e) => handleInputChange('required_openagents_version', e.target.value)}
                className="w-full p-3 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="0.5.1"
              />
            </div>

            {/* Capacity */}
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-gray-900 dark:text-gray-100">
                {t('profile.capacity')}
              </label>
              <Input
                type="number"
                variant="lg"
                value={formData.capacity}
                onChange={(e) => handleInputChange('capacity', parseInt(e.target.value) || 0)}
                min="1"
                className="w-full p-3 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="100"
              />
            </div>

            {/* Host */}
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-gray-900 dark:text-gray-100">
                {t('profile.host')}
              </label>
              <Input
                type="text"
                variant="lg"
                value={formData.host}
                onChange={(e) => handleInputChange('host', e.target.value)}
                className="w-full p-3 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="0.0.0.0"
              />
            </div>

            {/* Port */}
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-gray-900 dark:text-gray-100">
                {t('profile.port')}
              </label>
              <Input
                type="number"
                variant="lg"
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
