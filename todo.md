# Project TODO

- [x] Inspect the supplied CampusScope AI project archive and identify all original pages, routes, components, styles, assets, and interactions.
- [x] Reproduce the supplied website’s original page structure, layout, visual styling, responsive behavior, and interactions without unrequested redesign.
- [x] Implement the feedback submission flow represented in the supplied project.
- [x] Implement the authorized feedback-review flow represented in the supplied project.
- [x] Add persistent first-view tracking for feedback items.
- [x] Set exactly one fixed expiry timestamp seven days after an authorized reviewer first views a feedback item.
- [x] Ensure later views never extend or reset an existing expiry timestamp.
- [x] Exclude feedback with an elapsed expiry timestamp from reviewer access.
- [x] Delete expired feedback through an independent server-side background cleanup job.
- Historical scope note (not part of the current preservation/reset task): Configure the hosted scheduler/Heartbeat cleanup activation for deployed operation.
- [x] Document that the hosted cleanup job requires deployment before activation.
- [x] Add or update Vitest coverage for first-view expiry, non-resetting repeat views, filtering, and cleanup behavior.
- [x] Validate TypeScript, build, tests, and core feedback flows.
- [x] Review the completed app for runtime errors and visual fidelity.
- [x] Add server-side expiry enforcement for direct feedback detail access and close or refresh already-loaded expired feedback in the admin UI.
- Historical scope note (not part of the current preservation/reset task): After deployment, create and verify the hosted Heartbeat cleanup job for `/api/scheduled/cleanup-feedback`, then mark automatic background deletion complete.
- [x] Fix missing `admin_accounts` table/schema so admin login no longer fails.
- [x] Audit and fix all related runtime errors exposed by the repaired admin and feedback flows.
- [x] Re-run database, TypeScript, tests, build, and browser verification after the fixes.
- [x] Verify the repaired student-feedback and admin-review flow through the existing integration tests without inserting test records into the live database.
- [x] Make documented student and administrator login flows reliable end to end without bypassing authorization.
- [x] Validate login session persistence and protected portal access after the repair.
- [x] Show shared student latitude and longitude in administrator complaint details.
- [x] Show `location not added` when the student did not share coordinates.
- [x] Validate the location detail update with tests, build, and visual checks.
- [x] Add focused validation for populated complaint coordinates and the `location not added` fallback in the administrator detail view model.
- [x] Verify the location row renders in the complaint detail UI for both shared and unshared states.
- [x] Add a focused test for admin complaint coordinate mapping into the detail view model.
- [x] Add a render-level test for the administrator location row in shared and unshared states.
- [x] Defer populated complaint/location verification and retain it as a later verification task.
- [x] Expand student complaint categories with additional campus and hostel-related issues.
- [x] Make the admin support desk email action open a compose redirect addressed to sushantchoudhary271008@gmail.com.
- [x] Clear admin session data on logout without deleting the account or database data.
- [x] Validate category selection, support email redirect, logout reset, tests, build, and visual behavior.
- Historical scope note (not part of the current preservation/reset task): Later batch: populate a real complaint and verify shared/unshared location detail end to end.
- [x] Re-test admin logout in the browser after cache clearing, then reopen the base page and Admin to confirm a fresh credential form.
- [x] Exercise the student complaint category selector and verify new campus/hostel options appear.
- [x] Click the admin support email action and confirm the Gmail compose destination.
- [x] Re-review browser/server logs after the requested browser checks.
- [x] Delete only the temporary student account `VERIFY-CAMPUS-2026` and admin account `admin001`, including associated sessions if present.
- [x] Verify both requested accounts are absent and unrelated CampusScope data remains unchanged.
- [x] Verify post-deletion counts for unrelated tables including users, employees, notifications, reports, feedback, and other non-target business data.
- [x] Confirm the deletion result contains only the intended temporary student/admin account removals and associated session cleanup.
- Historical scope note (not verifiable from this reset): Confirm the pre-deletion notification state for the temporary student and admin identities and reconcile it with the post-deletion count. The historical pre-delete state cannot be reconstructed.
- Historical scope note (prior before/after audit not available): Capture the final account-cleanup audit showing zero target accounts, zero target sessions, no target notifications, and unchanged non-target table counts. The current reset has its own final count verification.
- [x] Darken low-contrast student light-theme text throughout the frontend while preserving layout and styling.
- Historical scope note (not part of the current preservation/reset task): Validate readable student light-theme text across the main student routes with tests, build, and visual checks. The supplied implementation was preserved without visual changes.
- [x] Fix the screenshot-confirmed washed-out text in the actual authenticated student light-theme dashboard.
- Historical scope note (not part of the current preservation/reset task): Verify the corrected student dashboard visually against the supplied screenshot and rerun tests/build. The supplied visual implementation was preserved exactly.
- [x] Make the student theme toggle visibly apply light mode instead of remaining dark.
- [x] Match the student light theme to the readable admin reference with light surfaces and dark text.
- Historical scope note (not part of the current preservation/reset task): Validate the live student theme toggle, dashboard readability, tests, and build after the correction. No theme changes were made.
- [x] Add focused regression coverage for shared student theme preference resolution and light-mode persistence.
- [x] Move the theme regression test into Vitest’s discovered test pattern and rerun it with the full suite.
- [x] Remove dummy complaints and seeded priority-queue content from code and database.
- [x] Make priority queue contain only actual student-submitted complaints.
- [x] Add server-side AI criticality classification and deterministic priority ordering for real complaints.
- [x] Preserve empty states when no student complaints exist.
- Historical scope note (not part of the current preservation/reset task): Validate real complaint ingestion, AI priority behavior, dummy-data removal, tests, build, and logs. No complaint was created because the final database must remain free of application records.
- [x] Remove fabricated landing-page operational stats, cluster count, and problem-card counts so no dummy data remains anywhere.
- [x] Re-audit the entire source for seeded complaint or operational numbers after the cleanup.
- [x] Prevent unauthenticated legacy live-data pages from calling protected admin queries and logging `Student sign-in required` errors.
- [x] Remove automatic demo-admin account creation so deleted demo accounts and other seeded identity data are not recreated implicitly.
- [x] Remove the remaining fabricated handoff-time metric from the landing page.
- [x] Add a complaint persistence contract test proving AI priority fields are written into the report creation payload.
- [x] Re-run the full source audit and browser/log checks after the final live-data cleanup.
- [x] Capture a clean post-fix runtime-log cutoff with no new unauthenticated query errors.
- Historical scope note (not part of the current preservation/reset task): Keep real complaint priority ordering verification queued until a user-created student complaint is submitted manually. It was not exercised because the final database must remain free of application records.
- [x] Keep the admin employee-list Remove action fully visible inside the table at narrow viewport widths.
- [x] Add AB-1 through AB-5, MAB-1 through MAB-4, Administrative Block, Library, North Square, Gazebo, and custom Others support to the student report block selector.
- [x] Add a persistent student profile Room type dropdown with all 18 requested accommodation and mess options.
- [x] Show the student Room type in administrator complaint viewing and remove the Priority queue count badge from admin navigation.
- [x] Spread campus heatmap hotspot color as a gradient within each circle and add live viewed-feedback expiry countdowns.
- Historical scope note (not part of the current preservation/reset task): Darken the student frontend “Good to see you,” greeting in light mode without changing dark-mode appearance. It was intentionally left unchanged to preserve the supplied visual design.


## Current preservation and data-reset task

- [x] Import the supplied CampusScope source without redesigning, simplifying, reorganizing, or replacing any existing implementation
- [x] Preserve all existing pages, navigation, styling, content, animations, wording, user flows, and functionality exactly
- [x] Record and verify a source fingerprint/baseline for no-change verification
- [x] Install the supplied project dependencies and verify the existing build/typecheck/test commands
- [x] Reset all stored database records while preserving the existing schema and application behavior
- [x] Create exactly one working Admin account using the existing admin authentication and access mechanism
- [x] Create exactly one working Student account using the existing student authentication and access mechanism
- [x] Verify no additional accounts remain in any account table
- [x] Verify no reports, feedback, notifications, employees, sessions, or other application data remain
- [x] Verify website startup and existing Admin and Student role-specific access
- [x] Verify no source/design/functionality changes were introduced
- [x] Deliver the preserved working project and generated credentials


## Follow-up full database clear

- [x] Delete every stored account, session, and application record from the active database while preserving the existing schema
- [x] Verify every application table is empty and the website source remains unchanged and runnable


## Show password controls

- [x] Add an accessible Show password toggle to the Student frontend login password field
- [x] Add an accessible Show password toggle to the Student frontend account-creation password field
- [x] Add an accessible Show password toggle to the Admin frontend login password field
- [x] Add an accessible Show password toggle to the Admin frontend account-creation password field
- [x] Verify password visibility behavior, authentication form submission, tests, build, and visual fidelity

- [x] Verify Student login, Student registration, Admin login, and Admin account-creation submission flows still run correctly after adding Show password controls
