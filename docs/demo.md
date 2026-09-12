# Five-minute team walkthrough

Start with `python scripts/dev.py` and open the website. Every supplied business, transaction, review and evidence record is fictional.

1. **Describe demand.** In the demo selector choose **Setu Packaging Studio**. Search `50 kg PET within 30 km`. Nearby suppliers have 30 kg, 25 kg and 18 kg PET lots. A complete local plan can combine two or more lots. The Ahmedabad supply is outside the default local radius.
2. **Show compatibility.** Search `50 kg plastic`. The interface can show PET and HDPE alternatives, but a single plan never mixes the two. Open **Filters & transport**, set transport budget to ₹0 and apply to demonstrate rejection of plans that exceed the budget. Clear it before continuing.
3. **Explain trust.** Open a supplier listing. Walk through the GST, photo, slip, completed-exchange and buyer-review components. Demo documents are explicitly marked as demonstrations.
4. **Send a request.** Select a PET supply plan, enter proposed pickup details and send it. The exchange shows a pending item for each supplier. Requesting alone leaves inventory available.
5. **Accept separately.** Switch to the first selected supplier, open Exchanges and accept the pending item. Repeat for the other supplier. Each acceptance reserves only its allocated quantity. The buyer sees whether every item has been accepted.
6. **Record the actual handover.** As supplier, enter actual transferred weight and confirm. Switch to the buyer and enter the same actual weight. Both confirmations complete that item; any unused reserved quantity is returned to availability.
7. **Leave a verified-transaction review.** The buyer's review form appears only after completion. Submit a rating and comment and inspect the supplier trust breakdown again.
8. **Show evidence review.** As a supplier, create a new listing, attach a real test photo or weighing document, and observe its pending status. Switch to **MaterialSetu Reviewer**, download the pending evidence and enter a review reference before approving it. Refresh the supplier's trust page to see coverage update.
9. **Show mobile parity.** Open the Expo app against the same backend. Its Discover, Pools, Exchanges, Supply and Account tabs use the same records. The reviewer queue is intentionally on the website.

Use dedicated test documents rather than sensitive business records for a hackathon demo. No real payments, transporter bookings or messages are sent by these actions.

## Reset a disposable demo

Stop the API. Back up anything you want to keep. Remove only the demo database `services/api/materialsetu.db` and its demo upload directory, then restart the demo runner to reseed. Do not do this against a pilot database.
