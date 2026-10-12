# Validation

`npm test` checks camera recovery from independent 3D points, known joint angles, missing observations, dwell and repeat counting, separate rise/return thresholds, invalid settings, and independence from manual-count labels. All counter inputs in this repository are synthetic.

`npm run test:browser` checks the empty state, responsive layout, settings reset, keyboard tabs and local manifest import. Synthetic CSV inputs cover duplicate subjects, editable height, conflicting values and invalid columns. The manifest test also checks that no external requests are made.

During development, local videos were used to check inference, calibration, cancellation, synchronized seeking, graph modes, frame pagination, ZIP/CSV downloads, ZIP round trip, attaching the original clip, malformed ZIP recovery, and WebM recording/cancellation. Videos, manifests, motion fixtures and individual results are kept outside the public repository.

Browser and Python decoders can produce different measurements. Physical H/V and angle accuracy have not been validated against measured references. Frame coverage indicates data availability, not accuracy. The supplied Demo weight table is a project rule, not an independent safety assessment.
