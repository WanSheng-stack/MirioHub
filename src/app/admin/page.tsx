"use client";

import { useEffect, useState } from "react";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/client";
import type { SystemConfig } from "@/lib/types";

export default function AdminPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [premiumId, setPremiumId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [serverUtc, setServerUtc] = useState<string | null>(null);

  useEffect(() => {
    if (!hasSupabaseEnv()) {
      setAllowed(false);
      return;
    }
    const supabase = createClient();
    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        setAllowed(false);
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", auth.user.id)
        .maybeSingle();
      if (!profile?.is_admin) {
        setAllowed(false);
        return;
      }
      setAllowed(true);
      const { data } = await supabase.from("system_configs").select("*").eq("id", 1).maybeSingle();
      setConfig(data as SystemConfig | null);
    })();
  }, []);

  async function toggleCampaign(enabled: boolean) {
    const supabase = createClient();
    const { data } = await supabase.rpc("set_global_free_campaign", {
      p_enabled: enabled,
    });
    const json = data as {
      ok?: boolean;
      is_global_free_campaign?: boolean;
      server_utc?: string;
      error?: string;
    };
    if (!json?.ok) {
      setMessage(json?.error ?? "切换失败");
      return;
    }
    setServerUtc(json.server_utc ?? null);
    setConfig((c) =>
      c ? { ...c, is_global_free_campaign: Boolean(json.is_global_free_campaign) } : c,
    );
    setMessage(enabled ? "已开启全网公测免费期" : "已关闭免费期，付费墙生效");
  }

  async function saveCopy() {
    if (!config) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("system_configs")
      .update({
        must_read_sr: config.must_read_sr,
        must_read_en: config.must_read_en,
        must_read_zh: config.must_read_zh,
        bank_name: config.bank_name,
        bank_recipient: config.bank_recipient,
        bank_account: config.bank_account,
        bank_reference: config.bank_reference,
        ips_qr_url: config.ips_qr_url,
        wechat_support_hint: config.wechat_support_hint,
      })
      .eq("id", 1);
    setMessage(error ? error.message : "文案已保存");
  }

  async function grantPremium() {
    const supabase = createClient();
    const { data } = await supabase.rpc("admin_set_premium", {
      p_user_id: premiumId,
      p_premium: true,
    });
    const json = data as { ok?: boolean; error?: string };
    setMessage(json?.ok ? "已开通会员" : json?.error ?? "失败");
  }

  if (allowed === null) {
    return <p className="p-6 text-sm">校验管理员权限…</p>;
  }

  if (!allowed) {
    return (
      <main className="mx-auto max-w-lg p-6 text-sm text-zinc-700">
        无权限。请先在个人中心登录，再于数据库执行：
        <code className="mt-2 block rounded bg-zinc-100 p-2 text-xs">
          update public.profiles set is_admin = true where id = &apos;你的用户 UUID&apos;;
        </code>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg space-y-6 p-6">
      <h1 className="text-xl font-semibold">MirioHub 运维后台</h1>
      <section className="rounded-lg border border-zinc-200 p-4">
        <h2 className="font-medium">全网公测免费开关</h2>
        <p className="mt-1 text-sm text-zinc-600">
          由云端 UTC 在 RPC 内读取本开关。前端不得写死截止日期。当前：
          <strong>
            {config?.is_global_free_campaign ? " 免费公测开启" : " 付费墙开启"}
          </strong>
        </p>
        {serverUtc ? (
          <p className="mt-1 text-xs text-zinc-500">最近一次服务端 UTC：{serverUtc}</p>
        ) : null}
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className="rounded-md bg-green-700 px-3 py-2 text-sm text-white"
            onClick={() => void toggleCampaign(true)}
          >
            开启全网免费
          </button>
          <button
            type="button"
            className="rounded-md bg-red-700 px-3 py-2 text-sm text-white"
            onClick={() => void toggleCampaign(false)}
          >
            关闭并启用付费墙
          </button>
        </div>
      </section>

      <section className="space-y-2 rounded-lg border border-zinc-200 p-4">
        <h2 className="font-medium">务必必读与收款要素</h2>
        {(
          [
            ["must_read_zh", "必读（中文）"],
            ["must_read_sr", "必读（塞语）"],
            ["must_read_en", "必读（英语）"],
            ["bank_name", "银行名"],
            ["bank_recipient", "收款人"],
            ["bank_account", "账号"],
            ["bank_reference", "付款参考"],
            ["ips_qr_url", "IPS QR 地址"],
            ["wechat_support_hint", "微信客服提示"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="block text-sm">
            {label}
            <textarea
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2"
              rows={key.startsWith("must_read") || key === "wechat_support_hint" ? 3 : 1}
              value={config?.[key] ?? ""}
              onChange={(e) =>
                setConfig((c) => (c ? { ...c, [key]: e.target.value } : c))
              }
            />
          </label>
        ))}
        <button
          type="button"
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm text-white"
          onClick={() => void saveCopy()}
        >
          保存文案
        </button>
      </section>

      <section className="rounded-lg border border-zinc-200 p-4">
        <h2 className="font-medium">开通 Premium</h2>
        <input
          className="mt-2 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          placeholder="用户 UUID"
          value={premiumId}
          onChange={(e) => setPremiumId(e.target.value)}
        />
        <button
          type="button"
          className="mt-2 rounded-md border border-zinc-300 px-3 py-2 text-sm"
          onClick={() => void grantPremium()}
        >
          设为会员
        </button>
      </section>

      {message ? <p className="text-sm text-green-800">{message}</p> : null}
    </main>
  );
}
