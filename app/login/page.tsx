"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (res.ok) {
      router.push("/");
    } else {
      setError("Wrong password");
    }
  }

  return (
    <div style={{ maxWidth: 400, margin: "120px auto", padding: "0 20px", fontFamily: "system-ui" }}>
      <h1>Collectibot</h1>
      <p style={{ color: "#666" }}>Enter password to continue</p>
      <form onSubmit={handleSubmit} style={{ marginTop: 20 }}>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          style={{
            width: "100%",
            padding: "12px 16px",
            fontSize: 16,
            border: "2px solid #ccc",
            borderRadius: 6,
            boxSizing: "border-box",
          }}
        />
        <button
          type="submit"
          style={{
            marginTop: 12,
            padding: "10px 24px",
            fontSize: 16,
            background: "#333",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          Enter
        </button>
        {error && <p style={{ color: "#c62828", marginTop: 12 }}>{error}</p>}
      </form>
    </div>
  );
}
