/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    typedRoutes: false
  },
  transpilePackages: ["@agentswarm/shared-types"]
};

export default nextConfig;
