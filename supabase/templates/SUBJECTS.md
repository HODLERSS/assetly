# Auth email subjects (paste into Supabase > Authentication > Emails once custom SMTP is set)

| Template | Subject | Body file |
|---|---|---|
| Confirm sign up | Confirm your Assetly account | confirmation.html |
| Magic link | Your Assetly sign-in link | magic_link.html |
| Reset password | Reset your Assetly password | recovery.html |
| Change email address | Confirm your new Assetly email | email_change.html |

Supabase only allows template edits with custom SMTP. Free option: a Gmail account for Assetly with an app
password (smtp.gmail.com:465, sender name "Assetly"). This also lifts the 2-emails/hour cap on the built-in sender.
