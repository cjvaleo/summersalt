# Lead tracker (both websites)

`LeadTracker.gs` catches every quote request from **trlightsnj.com** and
**summersaltdetailing.com** in one free Google Sheet, emails you the moment a
lead comes in, and sends you a morning list of who to text.

The same file lives in both repos. You only deploy it **once**, and both sites
use the same URL.

## 1. Make the Sheet

Go to <https://sheets.new> and name it **Leads**. Leave it empty.

## 2. Add the script

1. In the Sheet: **Extensions → Apps Script**.
2. Delete the placeholder `function myFunction() {}`.
3. Paste in all of `LeadTracker.gs`.
4. Optional now, needed later: in `CONFIG` near the top, replace
   `PASTE_SUMMER_SALT_REVIEW_LINK` and `PASTE_TR_LIGHTS_REVIEW_LINK` with your
   Google review links (Google Business Profile → **Ask for reviews** → copy link).
5. Click **save**.

## 3. Run setup once

1. In the function dropdown at the top, pick **setup** → **Run**.
2. Google asks for permission: pick your account → *"Google hasn't verified this
   app"* → **Advanced** → **Go to (project) (unsafe)** → **Allow**.
   That warning is normal. It's your own script.
3. Your Sheet now has columns, and the 8am email is scheduled.

## 4. Deploy it as a web app

1. **Deploy → New deployment**, click the gear, choose **Web app**.
2. **Execute as:** Me. **Who has access:** **Anyone** (not "Anyone with Google
   account", or the website can't send to it).
3. **Deploy**, then copy the **Web app URL** (ends in `/exec`).
4. Paste it in a browser tab. You should see
   `{"ok":true,"message":"Lead tracker is live."}`.

## 5. Put the URL in both websites

In each repo's `index.html`, find `var SHEET_URL='';` and paste the URL between
the quotes. Commit and push; Vercel redeploys on its own.

## 6. Test

Pick **testLeads** in the dropdown and **Run**. Two fake rows appear (one per
business) and you get two "New lead" emails. Delete the test rows after. Then
send yourself a real quote from each website.

## Updating the script later

Edits don't go live until you redeploy:
**Deploy → Manage deployments →** pencil **→ Version: New version → Deploy**.
The URL stays the same.

## Columns

| Column | What it is |
| --- | --- |
| Received | When the quote came in |
| Business | TR Lights or Summer-Salt |
| Name, Phone, Email, Town / Address | From the form |
| Details | What they picked (lights: where, colors, extras · detailing: vehicle, package, add-ons, day/time) |
| Quote $ | Detailing price after discounts. Blank for lights, since you price after measuring |
| **Status** | **You update this:** New → Quoted → Booked → Done (or Lost) |
| **Job Date** | **You type this** when you book |
| Texts OK | Whether they ticked "OK to text me reminders and offers" |
| Last Follow-up, Review Asked | Filled in by the morning email so nobody gets texted twice |
| Notes | Discounts, codes, first-time customer, their notes |
| Source | Where the lead came from: `Facebook ad 3`, `Google search`, `Instagram`, `Direct`, … |
| Lead ID | Hidden. Stops duplicate rows if someone goes back and changes their quote |

## If a save ever fails

Neither site can lose a lead over this. The lights form falls back to opening
Messages with the request filled in. The detailing form always opens Messages
anyway; saving to the Sheet happens alongside it. Failures show under
**Apps Script → Executions**.
