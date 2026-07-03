/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    typedRoutes: false
  },
  transpilePackages: ["@verft/shared-types"]
};

export default nextConfig;
