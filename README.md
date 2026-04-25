This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Twilio SMS Integration

Manadele sends SMS notifications for: schedule published, shift reminders, tip sheet approved.
All SMS is gated by per-employee opt-in (double opt-in via reply YES) and admin-toggled per notification type in Setup.

### Required environment variables

    TWILIO_ACCOUNT_SID=AC...        # From Twilio Console > Account Info
    TWILIO_AUTH_TOKEN=...           # From Twilio Console > Account Info (treat like a password)
    TWILIO_FROM_NUMBER=+1...        # The Twilio phone number you purchased (E.164 format)
    TWILIO_TEST_MODE=true           # When "true", logs to DB but never sends real SMS

### Going live — credential checklist

1. Sign up at twilio.com and verify your account
2. Buy a phone number with SMS capability
3. Copy the three values above into Vercel env vars (Project Settings > Environment Variables)
4. Set `TWILIO_TEST_MODE=false` once you've tested with a real number
5. Configure the inbound webhook URL in Twilio Console:
   - Phone Numbers > Manage > Active numbers > Click your number
   - Under "Messaging Configuration", set "A message comes in" to:
     `https://YOUR_DOMAIN/api/sms/webhook` (POST)
   - This handles STOP, HELP, and YES replies automatically

### Test mode

While `TWILIO_TEST_MODE=true`:
- Calls to `sendSMS()` log to the `sms_log` table with status `test_mode`
- The console prints what would have been sent
- No real SMS is dispatched
- Useful for verifying flows without burning credits or texting real people

### Compliance baked in

- All employees default to `sms_opt_in: false`
- Sending requires double opt-in (admin checks box → confirmation SMS sent → employee replies YES)
- STOP / UNSUBSCRIBE / CANCEL inbound messages auto-revoke opt-in
- HELP inbound messages auto-reply with help text
- Every outbound message includes "Reply STOP to unsubscribe. HELP for info." footer
- Every send attempt is logged in `sms_log` (audit trail for legal disputes)

### Admin features

- **Setup > SMS Notifications** — toggle each notification type on/off
- **Setup > SMS Notifications > View SMS log** — full audit log with filters (status, direction, search)
- **Employees > [edit] > SMS Notifications** — opt-in status per employee, send/resend invite, revoke consent
