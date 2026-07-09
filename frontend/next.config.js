/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone', // Required for Docker
  // NEXT_PUBLIC_ vars are embedded in the client bundle at build time
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || 'http://localhost:8080/api',
  },
}

module.exports = nextConfig
