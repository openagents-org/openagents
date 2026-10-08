/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // The only `next/image` sources are small static logos. Routing them
  // through `/_next/image` adds nothing but a failure point: when the
  // optimiser errors or runs out of quota the sidebar logo breaks and its
  // alt text spills into the brand block. Serve the files as-is.
  images: { unoptimized: true },
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
