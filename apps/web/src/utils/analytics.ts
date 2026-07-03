"use client";

export const trackEvent = (name: string, properties?: Record<string, unknown>): void => {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent("verft:analytics", {
      detail: {
        name,
        properties: properties ?? {},
        timestamp: new Date().toISOString()
      }
    })
  );
};
