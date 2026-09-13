# Walkthrough to present

This shows one complete deal, playing each of the three roles. It works on the
live site, which holds only real records, so create the accounts below first.

Open the website in **three browser windows** — one normal, two private — so
each role stays signed in side by side. Use test documents, never real business
records. No payments, bookings or messages are sent by anything here.

## Before you start: three accounts

| Window | Create account as | Business name (example) |
| :-- | :-- | :-- |
| 1 | **We generate surplus** | Shree Polymers |
| 2 | **We generate surplus** | Kalol Plastics |
| 3 | **We collect material** | Setu Recycling Works |

Keep the default Mehsana coordinates for all three, so they are near each other.
The admin signs in with `admin` / `admin` in whichever window is free when needed.

## 1. Each role sees only its own work

Point at the sidebar in each window. The generator has **My listings · Requests
· Trust & verification**, with no search. The collector has **Find materials ·
Exchanges · Trust & verification**, with no "List material" button. Say that the
API enforces the same split: a collector cannot list, a generator cannot request.

## 2. Generators list surplus

- **Shree Polymers:** List material → PET plastic, clean sorted, recycle, 35 kg,
  ₹24/kg. Open the listing and upload a photo and a weighing slip. Both show
  **pending** — worth nothing yet.
- **Kalol Plastics:** List material → PET plastic, clean sorted, recycle, 25 kg, ₹26/kg.
- Both: Trust & verification → enter a GSTIN (for example `24AAACS1234A1Z5`) and
  submit. Status becomes **pending**.

## 3. A person checks the evidence

Sign in as **admin / admin**. The sidebar has one entry: **Review centre**.

- In **Waiting for you**, download Shree Polymers' photo and slip, write what you
  checked, and approve each.
- In **Registered businesses**, press **GST** on Shree Polymers. Write
  *"Certificate checked against the GST register"* and **Approve**.
- Show the rest of the record: **Enter or correct the GST number**, **Reject**,
  and **Clear record** — and that every one of them needs a written reason.

Back in Shree Polymers' window, refresh Trust & verification: GST 25/25, and
photo and slip coverage have appeared.

## 4. The collector searches

In **Setu Recycling Works**, search `50 kg PET within 30 km`. Neither generator
has 50 kg alone. The **Supply pooling** column offers a plan combining both, with
material cost and a transport estimate. Search `50 kg plastic` to show that PET
and HDPE are offered separately and never mixed in one plan.

Open Shree Polymers' listing and walk through the trust breakdown: each line
says where its points came from.

## 5. One request, separate acceptances

Press **Request this supply** on the pooled plan, add pickup details, and send.
The exchange shows one pending item per generator. **Nothing is reserved yet.**

In each generator window, open **Requests** and press **Accept & reserve**. Only
that generator's share is held. Back as the collector, the exchange reads **All
suppliers accepted**.

## 6. Both sides confirm the handover

In a generator window enter the actual weight handed over and confirm. As the
collector, enter the same weight. The item completes; any unused reservation goes
back on sale. Enter different numbers on a second item to show both are refused
and either side can **Report issue** for the admin to settle.

## 7. A review only after a real deal

The collector's review form appears only on a completed item. Leave a rating, then
reopen the generator's trust breakdown to see completed handovers and reviews count.

## 8. The same on a phone

Open the Android app (or Expo Go on an iPhone). Sign in as the collector: Discover,
Pools, Exchanges, Account. Sign in as `admin`: only **Review** and **Account**,
with the same GST and document queue.

## Running it locally instead

`python scripts/dev.py` starts with demo mode on: clearly fictional businesses and
an **Explore as** menu that switches between them without passwords. The steps
above still apply, choosing accounts from that menu instead of signing up. To reset,
stop the API and delete only `services/api/materialsetu.db` and its upload folder.
Never do this against the live database.
