"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Result, Spin } from "antd";
import { resolveDefaultPath } from "../src/auth/access";
import { useAuth } from "../components/auth-provider";

export default function HomePage() {
  const router = useRouter();
  const { loading, session } = useAuth();

  useEffect(() => {
    if (loading) {
      return;
    }

    if (!session) {
      router.replace("/login");
      return;
    }

    const nextPath = resolveDefaultPath(session.user.scopes);
    if (nextPath) {
      router.replace(nextPath);
    }
  }, [loading, router, session]);

  if (loading || !session) {
    return <Spin fullscreen tip="Loading session" />;
  }

  const nextPath = resolveDefaultPath(session.user.scopes);
  if (!nextPath) {
    return <Result status="403" title="No Accessible Pages" subTitle="This account is authenticated but has not been granted any screen access." />;
  }

  return <Spin fullscreen tip="Redirecting" />;
}
