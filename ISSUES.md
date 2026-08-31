# Issues
###### Inert phpBB2 sort controls (found 2026-08-30 by the CSRF form sweep)
- [x] `memberlist_body.tpl` and `viewforum_body.tpl` each open a
  `<form method="post">` — phpBB2's "sort by" and "display topics from previous
  N days" controls — but Plank registers no POST handler for `/memberlist` or
  `/viewforum/:id`, so the Go buttons do nothing. Not a security issue (they
  reach no state-changing code, and the CSRF injector now stamps them anyway),
  just dead UI. Fix by adding POST handlers that redirect to the equivalent GET
  with query params, so sorting and day-filtering actually work.
###### FAQ
- [x] Links to sections in the faq page don't work.
###### User profile
- [x] When submitting the edit profile form, phpBB would redirect to an interstitial page with a link to return to the index. Plank does not do this. Implement this interstitial for every form submission where phpBB had it. Make sure it has the same links as phpBB would have had.
- [x] The user profile page in phpBB has a link to the faq entry about BBCode. Replicate this.
- [x] The user profile page in phpBB has a link to the PHP date format. Do a similar link in Plank, linking to the docs on whatever date formatting feature is appropriate. Update the wording of this section to match.
- [x] Avatar upload doesn't appear to work, unless it's erroring out silently. Implement it and make sure errors are surfaced to the user.
###### Forum index
- [x] On the index page, above the forum listing, phpBB has last visited and current time. Plank has current time in a different format. Update this to match what phpBB shows.
- [x] Topic and post counts are not correct in the forum listing. Make sure we're tracking this, implement it if needed, and display it correctly.
- [x] The bottom half of the footer, the one with online user stats, isn't on par with what phpBB shows. Update it to display the same data points in the same wording and format.
- [x] Make sure there's a link to the admin panel in the same way phpBB displayed it for admin users.
###### Individual forum (/viewforum/:id)
- [x] The `Moderator:` listed underneath the forum name looks suspiciously fake. Implement it. If this depends on implementing user groups and they're not yet implemented, leave this one unchecked and move on.
- [x] phpBB shows "Users browsing this forum:", and a list of users, with their role colors. Update Plank to match.
- [x] List of permissions in the lower right corner (You **can** moderate this forum, etc.) is missing. If this depends on implementing advanced per-forum ACLs, leave this unchecked and move on.
###### Search
- [x] Search result does not contain the last post time and link to user.
- [x] Author cell of search results does not link to user.
###### Topic (/viewtopic)
- [x] "edit" and "ip" buttons are using the wrong image paths, resulting in broken images
- [x] Thread moderation controls (lock, move, etc.) aren't showing up even though the user is admin. If this depends on implementing advanced per-forum ACLs, leave this unchecked and move on.
- [x] "Jump to" control from phpBB is missing.
###### Message editor (/posting)
- [x] "Topic review" is missing when replying to a topic
- [x] Emoticons are out of order and some are duplicated. Make sure they're displayed in the same order as in phpBB.
- [x] Controls for normal/sticky/announcement topic type are missing. If this depends on implementing advanced per-forum ACLs, leave this unchecked and move on.
- [x] Controls for adding a poll are missing.
- [x] Sticky/Announcement prefixes use square brackets instead of phpBB's colon format, and [ Poll ] prefix is missing from topics with polls.