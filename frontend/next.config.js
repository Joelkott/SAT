/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone', // Required for Docker
  // Note: NEXT_PUBLIC_ env vars are automatically exposed to the browser
  // No need to manually add them to env config
  // API_URL (without NEXT_PUBLIC_) is available server-side only
}

module.exports = nextConfig
