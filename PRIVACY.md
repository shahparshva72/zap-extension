# Privacy Policy for Zap

**Effective date: October 13, 2026**

Zap is a browser extension developed by Parshva Shah that lets you remove webpage
elements, change colors and fonts, and replace text. This policy describes how Zap
handles information when you use these features.

## Information Zap accesses and stores

Zap accesses the current website’s address and page content to let you select
elements and apply your customizations, called boosts. When you save a boost, Zap
stores the following information in your browser’s local extension storage
(`chrome.storage.local`):

- The website’s hostname, the page’s full URL, and its title.
- A selector identifying the chosen element and a short label derived from the
  element’s text, accessibility label, or markup.
- The customization type and values, such as colors, a font family, or an element
  removal rule. Text boosts include both the original text and your replacement text.
- A rule identifier and the date and time the rule was created.

URLs, page titles, and selected text may contain personal or sensitive information,
depending on the pages you customize. Zap uses this information only to provide
its customization features, including displaying, finding, restoring, and
reapplying your saved boosts.

Zap checks the current website to apply matching rules on later visits. It does
not maintain a general browsing-history log or access Chrome’s browsing-history
database. Removing an element with Shift+click is temporary and does not create a
saved boost.

## Where information goes

Saved boosts stay in your local browser profile. Zap does not use Chrome Sync to
synchronize them, and it has no developer-operated backend, account system,
analytics service, advertising tracker, or remote error-reporting service.
The extension does not send your saved rules, page content, or browsing data to
the developer or to third-party servers.

The developer does not sell or rent extension user data, use it for advertising,
or use it to train AI models.

Boosts change the webpage in your browser. Scripts running on that webpage may
be able to observe the resulting text and style changes. This policy does not
govern the websites you visit or their own data handling.

## Imports and exports

When you choose **Export JSON**, Zap creates a file on your device containing your
saved rules, including page URLs, titles, labels, and any original or replacement
text. This file is readable JSON and is not encrypted by Zap. You decide whether
to share it; anyone receiving it can read its contents.

When you choose **Import JSON**, Zap reads the file you select, validates its rules,
and merges valid rules into local extension storage. It does not upload the file.

## Permissions

- **Storage:** saves and retrieves your boosts locally.
- **Scripting:** runs Zap’s bundled code on supported pages to enable customization.
- **Access to HTTP and HTTPS websites:** lets you select elements and automatically
  reapply saved boosts on the websites you revisit.

These permissions support Zap’s visible customization features. They are not used
for advertising, profiling, or unrelated tracking.

## Retention, security, and your controls

Saved rules remain in local extension storage until you delete them or the browser
removes that storage. Use **Restore** to delete a single rule, **Restore all** to
delete a site’s rules, or **Manage all boosts → Restore everything** to delete all
saved rules. Uninstalling the extension removes its local extension storage.

Exported files are separate copies. Deleting rules or uninstalling Zap does not
delete files you exported or copies you shared; delete those separately if needed.
Disabling the extension stops it from running but does not delete saved rules.

Zap relies on the browser and operating system to protect local storage and does
not add its own encryption layer. The developer cannot remotely access, recover,
or delete your locally stored boosts.

## Chrome Web Store Limited Use

Zap’s use of information received from Chrome APIs adheres to the Chrome Web Store
User Data Policy, including its
[Limited Use requirements](https://developer.chrome.com/docs/webstore/program-policies/limited-use).
Information is used only to provide the
user-facing customization features described in this policy.

## This policy page and support

This policy and Zap’s source code are hosted on GitHub. Visiting the repository
or submitting a support issue is subject to
[GitHub’s privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).
Information you voluntarily post in a public issue is visible to the developer
and other visitors and may be used to respond to your request. Do not include
private page content or sensitive exported rules in a public issue.

For privacy questions, contact Parshva Shah through the
[Zap issue tracker](https://github.com/shahparshva72/zap-extension/issues).

## Changes to this policy

This page will be updated if Zap’s data handling changes. The effective date above
identifies the latest policy revision, and previous revisions remain available in
the repository’s history.
