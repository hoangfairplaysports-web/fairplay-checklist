#!/bin/bash
# Bật kênh "CEO AI báo cáo qua Telegram" (chạy 1 lần trên máy Mac).
# - Tạo khoá bí mật riêng cho CEO (lưu ở ~/.claude/skills/fairplay-ceo/.ceo-secret, không in ra màn hình)
# - Nạp khoá lên Supabase và deploy function cl-ceo-report
# - Gửi 1 tin thử về Telegram của quản lý
set -e
cd "$(dirname "$0")/.."
REF=ralgsuvbupccjhboiafl
KEY=~/.claude/skills/fairplay-ceo/.ceo-secret
umask 077
[ -s "$KEY" ] || openssl rand -hex 32 > "$KEY"
chmod 600 "$KEY"
TMP=$(mktemp); trap 'rm -f "$TMP"' EXIT
printf 'CEO_REPORT_SECRET=%s\n' "$(cat "$KEY")" > "$TMP"
echo "1/3 Nạp khoá lên Supabase…"
npx --yes supabase@latest secrets set --env-file "$TMP" --project-ref "$REF"
echo "2/3 Deploy function cl-ceo-report…"
npx --yes supabase@latest functions deploy cl-ceo-report --project-ref "$REF"
echo "3/3 Gửi tin thử…"
sleep 3
printf '✅ CEO AI Fairplay đã kết nối Telegram.\nTừ mai: 7:45 giao ban sáng, 17:45 tổng kết ngày.' | ~/.claude/skills/fairplay-ceo/send-telegram.sh
echo
echo "Xong. Kiểm tra Telegram (bot @fridayofnh10bot)."
