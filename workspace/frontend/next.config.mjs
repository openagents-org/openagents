/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  async redirects() {
    return [
      // NOTE: `/` on workspace.openagents.org used to redirect to the marketing
      // site. As of v1.0 `/` is the enforced-login Membership Home (workspace
      // picker), so that redirect is intentionally removed.
      {
        source: '/install.sh',
        destination: 'https://raw.githubusercontent.com/openagents-org/openagents/develop/scripts/install.sh',
        permanent: false,
      },
      {
        source: '/install.ps1',
        destination: 'https://raw.githubusercontent.com/openagents-org/openagents/develop/scripts/install.ps1',
        permanent: false,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: '/wsapi/:path*',
        destination: 'https://workspace-endpoint.openagents.org/:path*',
      },
    ];
  },
};

export default nextConfig;
