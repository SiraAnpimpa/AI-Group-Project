# G07 Lifting Analysis

Browser version of the group's single-clip lifting analysis tool. The student selects a local video and the lifter's height, runs analysis, reviews measurements against the video, and downloads results. The user asked to give results more space than setup. Keep the G07 identity, Thai labels, the existing white/teal visual language, and the desktop calculation rules.

Run inference and calculation locally in the browser so GitHub Pages can host the application without a Python server. No video upload, analytics, sign-in, or data collection. Videos, heights, manifests, motion signals and individual results stay local and are not published in the repository. A local manifest can populate the subject selector. MediaPipe Pose Lite is pretrained; no new model training occurred. Manual counts are comparisons, never counter inputs.

Desktop and browser decoders/inference may produce different numerical outputs. Verify the web implementation on the real clips before reporting its counts. Coverage measures data availability, not accuracy. The weight table is the supplied Demo rule, not an independent safety assessment.
