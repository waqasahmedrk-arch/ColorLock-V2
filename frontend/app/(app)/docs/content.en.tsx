import Link from "next/link";
import Disclosures from "@/components/Disclosures";
import { Callout, Cards, Faq, H3, Kbd, Lead, Steps, Table, Terms, type DocFacts, type Docs } from "./ui";

export default function docsEn(f: DocFacts): Docs {
  const crop = Math.round(f.crop * 100);
  return {
    kicker: "Documentation",
    title: "ColorLock user manual",
    lead: "What ColorLock is for, how the measurement works, and a step-by-step guide to every part of the system.",
    toc: "Contents",
    onThisPage: "On this page",
    readTime: (m) => `${m} min read`,
    sections: [
      {
        id: "overview",
        icon: "info",
        title: "Overview",
        body: (
          <>
            <Lead>
              ColorLock is a <strong>measurement study</strong>, not an image model. It measures how accurately and how
              consistently two off-the-shelf text-to-image models reproduce a colour they were asked for, and it lets you
              apply exactly the same measurement to your own images.
            </Lead>
            <Callout kind="note" title="The models are not ours. The measurement is.">
              The image models are used unchanged, loaded from Hugging Face at pinned versions. Nothing is trained or
              fine-tuned. What ColorLock owns is the measurement code (the <code>colourlock</code> package,
              version {f.version} here), which reproduces the research notebook&apos;s numbers exactly.
            </Callout>
            <Cards items={[
              { icon: "chart", title: "Explore the study", body: "Browse the frozen, published results: every image, every score and the hypothesis tests, with full provenance." },
              { icon: "pipette", title: "Score your images", body: "Upload an image, choose a target colour and get the study's metrics: ΔE00, flatness QC and chroma drift." },
              { icon: "history", title: "Keep a record", body: "Every score you make is saved to your history, searchable by name, and exportable as PDF, Excel, CSV or JSON." },
            ]} />
          </>
        ),
      },
      {
        id: "purpose",
        icon: "flask",
        title: "Purpose and target",
        body: (
          <>
            <p>
              Text-to-image models are increasingly used where colour matters (brand assets, product imagery, design
              mock-ups), yet &ldquo;make it royal blue&rdquo; carries no guarantee. ColorLock asks a precise question: <em>when
              a model is told a colour, how close does it get, and how repeatable is it?</em>
            </p>
            <H3>Goals</H3>
            <Steps items={[
              { title: "Publish the evidence", body: "Present the study's dataset and results so that every claim can be inspected down to the individual image." },
              { title: "Offer the instrument", body: "Let anyone score their own images with the identical metric definitions, so results are comparable." },
              { title: "Generate and score (planned)", body: "A later phase will generate new images with the study's models at the study's settings and score them on the spot." },
            ]} />
            <H3>Who it is for</H3>
            <Table head={["User", "What they get"]} rows={[
              ["Reviewers and readers of the paper", "The data behind each result, with provenance and disclosures"],
              ["Researchers", "The same colour metrics for their own generated images, plus exports for analysis"],
              ["Designers and curious visitors", "A quick, objective check of how far an image's colour is from the one intended"],
            ]} />
            <H3>Research questions</H3>
            <Terms items={[
              { term: "H1", def: "Accuracy (ΔE00 to the target) and consistency (ΔE00 to the group's own average colour) are separate qualities: a model can be consistent yet consistently wrong." },
              { term: "H2", def: "Colour drift is biased towards desaturation: generated colours tend to be less saturated than the target (one-sided Wilcoxon signed-rank test on chroma)." },
              { term: "H3", def: "Some prompt styles give more consistent colour than others (Levene and Kruskal–Wallis tests)." },
            ]} />
            <p className="docs-muted">The test results themselves are on the <Link href="/">Results</Link> page.</p>
          </>
        ),
      },
      {
        id: "study",
        icon: "chart",
        title: "The study",
        body: (
          <>
            <Table head={["Design", "Value"]} rows={[
              ["Models", "FLUX.1-schnell and SDXL base 1.0, run locally"],
              ["Target colours", "8 CSS3/X11 colours spread around the hue wheel"],
              ["Prompt styles", "A hex only · B name + hex · C reference object · D explicit CIELAB · E name only"],
              ["Images per cell", "32"],
              ["Total", "2 models × 8 colours × 5 styles × 32 = 2,560 images"],
              ["Reference", "CSS3/X11 hex values converted to CIELAB (open and reproducible; not Pantone)"],
            ]} />
            <H3>Quality control: flatness</H3>
            <p>
              The study asks for a flat field of a single colour. Before an image counts towards accuracy it must pass a
              <strong> flatness check</strong>: the 95th-percentile ΔE00 of the central crop&apos;s pixels from their median
              colour must be <strong>≤ {f.threshold}</strong>. Images were generated once and filtered transparently. Retrying
              until an image passes would bias the sample, so it was not done.
            </p>
            <Callout kind="warn" title="Read the disclosures">
              Some design choices limit what the results can show. The most important: very few SDXL images pass the
              flatness check, so model comparisons rest mostly on FLUX. The full list is below and is shown on every
              results page.
            </Callout>
            <Disclosures />
          </>
        ),
      },
      {
        id: "concepts",
        icon: "ruler",
        title: "Key concepts",
        body: (
          <Terms items={[
            { term: "ΔE00 (CIEDE2000)", def: "The standard measure of perceived colour difference. Lower is closer: around 1 is barely perceptible, above about 5 is clearly different." },
            { term: "CIELAB (L*, a*, b*)", def: "A perceptual colour space: L* is lightness, a* runs green to red, b* blue to yellow. All measurements are made in CIELAB." },
            { term: "Chroma (C*)", def: "Colourfulness, √(a*² + b*²). Lower chroma than the target means the colour came out duller." },
            { term: "Accuracy", def: "ΔE00 between an image's measured colour and its target colour." },
            { term: "Consistency", def: "ΔE00 between each image and the average colour of its group (same model, colour and prompt style). Defined only for images that pass QC." },
            { term: "Measured colour", def: `The dominant colour of the central crop: the middle ${crop}% of the image's width and height, so borders and corners don't count.` },
            { term: "Flatness (p95)", def: `How uniform the crop is: the 95th-percentile ΔE00 of its pixels from their median. An image passes QC when this is ≤ ${f.threshold}.` },
            { term: "kept_pct", def: "A legacy foreground-share figure kept for comparison. It is not used for QC." },
          ]} />
        ),
      },
      {
        id: "start",
        icon: "user",
        title: "Getting started",
        body: (
          <>
            <Steps items={[
              { title: "Create an account", body: <>Choose <strong>Sign up</strong>, enter your name, email and a password (at least 8 characters with a letter and a number). A 6-digit code is emailed to you. Enter it to verify your address.</> },
              { title: "Sign in", body: <>Use your email and password. Tick <strong>Keep me signed in</strong> to stay signed in on this device. If you forget your password, use <strong>Forgot password</strong> to get a reset code.</> },
              { title: "Find your way around", body: <>The navbar links lead to <strong>Results</strong>, <strong>Images</strong>, <strong>Score</strong>, <strong>Provenance</strong> and <strong>History</strong>. Your avatar menu holds Profile, Settings and this Documentation.</> },
              { title: "Choose language and theme", body: <>Switch between <strong>EN</strong> and <strong>繁中</strong> in the navbar; your choice is saved to your account. The sun/moon button toggles light and dark mode.</> },
            ]} />
          </>
        ),
      },
      {
        id: "explore",
        icon: "image",
        title: "Exploring the study",
        body: (
          <>
            <H3>Results</H3>
            <p>
              The results grid shows each model × colour × prompt-style cell with its mean accuracy, consistency, QC pass
              rate and sample size. Cells with fewer than 10 QC-passed images are <strong>hatched</strong>: their statistics
              are unstable and should not be compared with full cells. The hypothesis tests (H1–H3) appear with their
              statistic, p-value and direction. Click a cell to see its images.
            </p>
            <H3>Images</H3>
            <p>
              Browse all 2,560 study images. Filter by model, colour, prompt style and QC result. Open an image to see its
              full record: the measured and target colours, every metric, and the seed that produced it.
            </p>
            <H3>Provenance</H3>
            <p>
              Shows exactly what produced the numbers: model repositories and pinned revisions, precision, steps,
              guidance, resolution, the QC settings and the measurement package version. Long values have a copy button.
            </p>
          </>
        ),
      },
      {
        id: "score",
        icon: "pipette",
        title: "Scoring an image",
        body: (
          <>
            <Steps items={[
              { title: "Add your image", body: <>Drag a <strong>PNG</strong> (preferred) or JPEG onto the upload area, or click to browse. Maximum 10 MB and 2048 px on the long side. The preview outlines the central area that will be measured.</> },
              { title: "Choose the target colour", body: <>Pick one of the 8 study colours, or <strong>Custom</strong> to enter any <code>#RRGGBB</code> hex value or use the colour picker.</> },
              { title: "Name the score", body: <>Every saved score needs a <strong>name</strong> that is unique in your history (ignoring upper/lower case). The file name is suggested for you. A live check tells you if the name is already used.</> },
              { title: "Score it", body: <>Press <strong>Score image</strong>. The result appears beside the form and is saved to your history automatically.</> },
            ]} />
            <H3>Reading the result</H3>
            <Table head={["Shown", "Meaning"]} rows={[
              ["Target vs measured", "Your target colour beside the colour that was actually measured"],
              ["ΔE00", "How far apart they are; the label gives a rule-of-thumb reading (not a study threshold)"],
              ["Flatness QC", `Pass when the crop is a flat colour (p95 ≤ ${f.threshold}). If it fails, treat the ΔE00 with caution: the study would have excluded this image`],
              ["Chroma", "Saturation of the measured colour vs the target. Negative Δ means the image came out duller"],
              ["Technical details", "Both CIELAB values, kept_pct, the package version and the score id"],
            ]} />
            <Callout kind="tip" title="Getting reliable numbers">
              Use PNG: JPEG compression shifts colours, and you will see a warning. Images with transparency are placed on
              white, and non-sRGB colour profiles are converted to sRGB before measuring; both are noted as warnings.
            </Callout>
          </>
        ),
      },
      {
        id: "history",
        icon: "history",
        title: "History and reports",
        body: (
          <>
            <p>
              <strong>History</strong> lists every score you have saved, newest first, grouped by day, 20 per page. The
              cards at the top summarise your whole history: number of scores, how many passed QC, your best and your
              average ΔE00.
            </p>
            <Steps items={[
              { title: "Search", body: <>Type in the search bar to find scores by <strong>name</strong>. Matches are highlighted; <Kbd>Esc</Kbd> clears the search. The search is kept in the address, so you can bookmark or share it.</> },
              { title: "Inspect or delete", body: "Open a row's details for every metric and warning. Delete a single score with the bin icon, or clear the whole history." },
              { title: "PDF report", body: <>Choose <strong>PDF report</strong>, pick <em>All dates</em>, <em>Today</em>, <em>Last 7 / 30 days</em> or a <em>Custom range</em>, and check the live count. The report opens in a new tab with the print dialog. Choose <strong>Save as PDF</strong>. Each row also has its own one-page PDF.</> },
              { title: "Excel export", body: <>The <strong>Excel</strong> button downloads your whole history as a workbook: one row per score with every measured value, plus an <em>About</em> sheet explaining each column. CSV and JSON exports are in Settings.</> },
            ]} />
            <Callout kind="note">
              Exports and reports contain single-image measurements. Consistency and the study&apos;s hypothesis tests
              belong to the frozen study dataset only and are never computed from your scores.
            </Callout>
          </>
        ),
      },
      {
        id: "account",
        icon: "settings",
        title: "Account, notifications and settings",
        body: (
          <>
            <Table head={["Where", "What you can do"]} rows={[
              ["Profile", "Change your name, profile photo and optional details: job title, phone number, date of birth and gender"],
              ["Settings › Appearance", "Theme (light, dark, match system) and language"],
              ["Settings › Notifications", "Turn score highlights on or off; security alerts are always on"],
              ["Settings › Security", "Change your password; see every signed-in device and sign any of them out"],
              ["Settings › Your data", "Export your history (Excel, CSV, JSON) or clear it"],
              ["Settings › Delete account", "Permanently remove your account, photo and history"],
            ]} />
            <H3>Notifications</H3>
            <p>
              The bell in the navbar shows unread notifications: <strong>security alerts</strong> (a sign-in from a new
              browser, password changes, devices signed out) and <strong>score highlights</strong> (a new personal-best ΔE00,
              milestones such as your 10th or 100th score). Open one to go to the related page, or see them all on the
              Notifications page.
            </p>
          </>
        ),
      },
      {
        id: "privacy",
        icon: "lock",
        title: "Data and privacy",
        body: (
          <Cards items={[
            { icon: "image", title: "Images are not kept", body: "Uploaded images are measured and discarded. Only the results and the original file name are saved." },
            { icon: "shield", title: "Your history is private", body: "Only you can see your scores, reports and notifications. Names only need to be unique within your own history." },
            { icon: "trash", title: "You stay in control", body: "Export everything at any time, delete single scores, clear your history, or delete your account completely." },
          ]} />
        ),
      },
      {
        id: "faq",
        icon: "alertCircle",
        title: "FAQ and troubleshooting",
        body: (
          <Faq items={[
            { q: "Why did my image fail the flatness QC?", a: `The central crop isn't a single flat colour (its p95 ΔE00 is above ${f.threshold}): it may contain texture, gradients, objects or lighting. The ΔE00 is still reported, but the study would not have counted it.` },
            { q: "Why does it say the name is already used?", a: "Score names must be unique in your history, ignoring upper/lower case. Choose a different name, or search History to find the existing score." },
            { q: "Is a JPEG result wrong?", a: "Not wrong, but less reliable: JPEG compression shifts colours. Use PNG whenever you can." },
            { q: "Can I compare my score with the study's results?", a: "The per-image metrics are computed identically, so a single ΔE00 is directly comparable. Group statistics such as consistency and the hypothesis tests only exist for the study dataset." },
            { q: "My login code didn't arrive.", a: "Check your spam folder and wait a minute before requesting a new code. Codes expire after 10 minutes." },
            { q: "The PDF has no colours.", a: "In the print dialog, make sure background graphics are enabled. ColorLock asks the browser to keep them, but some browsers let you switch this off." },
          ]} />
        ),
      },
    ],
  };
}
