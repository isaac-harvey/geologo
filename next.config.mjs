/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: '/tools/geologo',
  assetPrefix: '/tools/geologo',
  reactStrictMode: true,
  experimental: { typedRoutes: true },
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
};
export default nextConfig;
