import type { Metadata } from "next";
import { LearnPhotoGallery } from "@/components/learn-photo-gallery";
import { Footer } from "@/components/footer";

export const metadata: Metadata = {
  title:
    "What Does Hail Damage Look Like on Asphalt Shingles? The Definitive Identification Guide",
  description:
    "Asphalt shingles are the most common roofing material in America and the most frequently hail-damaged. Learn to identify hail hits on 3-tab and architectural shingles using the chalk test, bruise test, and granule displacement patterns. Covers Class 1-4 impact ratings, Xactimate codes, and how dumbroof.ai analyzes shingle photos for insurance claims.",
  keywords: [
    "hail damage asphalt shingles",
    "what does hail damage look like on shingles",
    "shingle hail damage signs",
    "hail damage vs normal wear",
    "hail damage identification shingles",
    "chalk test hail damage",
    "bruise test shingles",
    "granule loss hail",
    "3-tab hail damage",
    "architectural shingle hail damage",
  ],
  openGraph: {
    title:
      "What Does Hail Damage Look Like on Asphalt Shingles? Definitive Identification Guide",
    description:
      "Identify hail damage on 3-tab and architectural asphalt shingles using the chalk test, bruise test, and granule patterns. Covers impact ratings, Xactimate codes, and AI photo analysis.",
    type: "article",
    publishedTime: "2026-04-03T00:00:00Z",
    authors: ["Tom Kovack Jr."],
  },
};

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "What does hail damage look like on asphalt shingles?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Hail damage on asphalt shingles appears as random, circular dark spots where granules have been displaced by impact. On 3-tab shingles, hits often expose the black asphalt mat beneath the granule layer. On architectural (dimensional) shingles, damage appears as soft bruised areas that may not show obvious granule loss but feel spongy when pressed. Collateral damage to gutters, vents, and soft metals confirms a hail event.",
      },
    },
    {
      "@type": "Question",
      name: "How do you perform the chalk test for hail damage on shingles?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Rub chalk lightly across a suspected hail hit. Where granules are missing or displaced, chalk fills the exposed asphalt mat and creates a visible bright mark against the surrounding granule surface. Undamaged areas resist the chalk because intact granules deflect the marking. The chalk test makes subtle damage visible in photographs and is widely accepted by insurance adjusters as field evidence.",
      },
    },
    {
      "@type": "Question",
      name: "What is the bruise test for hail damage?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Press your thumb firmly into a suspected hail hit area on the shingle. If the mat beneath feels soft, spongy, or gives under pressure, the underlying fiberglass or organic mat has been fractured by impact. Undamaged areas feel firm and rigid. The bruise test confirms structural compromise even when surface granule loss is minimal, proving the shingle has lost its weatherproofing integrity.",
      },
    },
    {
      "@type": "Question",
      name: "How do you tell the difference between hail damage and normal shingle wear?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Hail damage is random in placement, circular or irregular in shape, and concentrated in a directional pattern matching the storm path. Normal wear shows uniform granule loss across the entire roof, especially in water-flow channels. Blistering produces raised bubbles with intact granules around the edges. Manufacturing defects follow the shingle production line in repeating patterns. Hail damage also dents soft metals (vents, gutters) while aging does not.",
      },
    },
    {
      "@type": "Question",
      name: "How does dumbroof.ai analyze asphalt shingle hail damage photos?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "dumbroof.ai uses AI forensic analysis to detect granule displacement patterns, measure impact density per test square, identify directional hail swath patterns, and differentiate hail damage from blistering, aging, and manufacturing defects. The platform generates a forensic causation report with annotated photos, an Xactimate-style estimate with applicable RFG codes and building code citations, a carrier comparison letter, a supplement letter, and a branded cover email — all from uploaded inspection photos in under 15 minutes.",
      },
    },
  ],
};

const articleSchema = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline:
    "What Does Hail Damage Look Like on Asphalt Shingles? The Definitive Identification Guide",
  author: { "@type": "Person", name: "Tom Kovack Jr." },
  publisher: {
    "@type": "Organization",
    name: "Dumb Roof Technologies",
    url: "https://www.dumbroof.ai",
  },
  datePublished: "2026-04-03",
  dateModified: "2026-04-03",
  mainEntityOfPage:
    "https://www.dumbroof.ai/learn/hail-damage-to-asphalt-shingles",
  description:
    "The definitive guide to identifying hail damage on asphalt shingles — America's most common roofing material. Covers 3-tab and architectural shingles, the chalk test, bruise test, granule patterns, impact ratings, Xactimate codes, and AI photo analysis.",
};

export default function AsphaltShingleHailDamagePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }}
      />

      <main className="min-h-screen">
        <article className="max-w-3xl mx-auto px-6 pt-12 pb-20">
          {/* Breadcrumb */}
          <nav className="text-sm text-[var(--gray-muted)] mb-8">
            <a href="/" className="hover:text-white transition-colors">
              Home
            </a>
            <span className="mx-2">/</span>
            <a href="/learn" className="hover:text-white transition-colors">
              Learn
            </a>
            <span className="mx-2">/</span>
            <span className="text-[var(--gray)]">
              Asphalt Shingle Hail Damage
            </span>
          </nav>

          <header className="mb-12">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--red)]">
              Material-Specific
            </span>
            <h1 className="text-3xl sm:text-4xl font-bold text-[var(--white)] mt-2 mb-4 leading-tight">
              What Does Hail Damage Look Like on Asphalt Shingles?
            </h1>
            <p className="text-[var(--gray-muted)] text-sm">
              By Tom Kovack Jr. &middot; April 3, 2026 &middot; 13 min read
            </p>
          </header>

          {/* Direct Answer */}
          <p className="text-lg text-[var(--gray)] leading-relaxed mb-8">
            <strong className="text-[var(--white)]">
              Hail damage on asphalt shingles appears as random, circular dark
              spots where granules have been knocked loose by impact, exposing
              the black asphalt mat or fiberglass reinforcement beneath.
            </strong>{" "}
            On 3-tab shingles, hits typically punch through the single-layer
            granule surface and leave obvious dark circles. On architectural
            (dimensional) shingles, the thicker laminated construction absorbs
            more impact energy, so damage often presents as soft, spongy bruises
            that may not show dramatic granule loss but have compromised the
            underlying mat. Because asphalt shingles cover roughly 80% of
            American homes, this is the most frequently claimed roofing material
            after hailstorms and the one adjusters inspect most often.
          </p>

          {/* Key Stat Box */}
          <div className="glass-card p-6 mb-10">
            <p className="text-sm text-[var(--gray)] leading-relaxed">
              <strong className="text-[var(--white)]">Key stat:</strong> Asphalt
              shingles account for approximately{" "}
              <strong className="text-[var(--white)]">80%</strong> of the
              residential roofing market in the United States. The Insurance
              Institute for Business &amp; Home Safety (IBHS) estimates that
              hail causes over{" "}
              <strong className="text-[var(--white)]">
                $10 billion in property damage
              </strong>{" "}
              annually, with asphalt shingle roofs representing the vast
              majority of claims.
            </p>
          </div>

          {/* Photo Gallery */}
          <LearnPhotoGallery
            damageType="hail"
            limit={6}
            heading="Real Asphalt Shingle Hail Damage From Processed Claims"
          />

          {/* Section 1 — Anatomy of an Asphalt Shingle */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-4">
            Anatomy of an Asphalt Shingle: Why Granules Matter
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Understanding shingle construction is essential before diagnosing
            hail damage. Every asphalt shingle consists of the same basic
            layers: a fiberglass mat core that provides structural strength, an
            asphalt coating that waterproofs the mat, and a surface layer of
            ceramic-coated mineral granules that shield the asphalt from
            ultraviolet radiation.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Granules are the shingle&apos;s first line of defense. They reflect
            UV rays, add fire resistance, and provide the color and texture
            homeowners see from the ground. When hail displaces granules, it
            exposes the asphalt layer directly to sunlight. UV radiation then
            accelerates oxidation of the asphalt binder, causing the shingle to
            dry out, crack, and curl far sooner than its rated service life.
            This is why even &quot;cosmetic&quot; granule loss constitutes
            functional damage. A shingle that loses its granule protection in
            scattered impact zones will fail years before an undamaged shingle
            on the same roof.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Beneath the granule surface, the fiberglass mat can fracture on
            impact without any visible surface change. This subsurface fracture
            weakens the shingle&apos;s tensile strength and creates pathways for
            moisture to reach the roof deck. The bruise test (described below)
            detects this hidden mat fracture.
          </p>

          {/* Section 2 — 3-Tab vs Architectural */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-4">
            Hail Damage on 3-Tab vs. Architectural (Dimensional) Shingles
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            The two dominant asphalt shingle types react differently to hail,
            and adjusters evaluate them using distinct criteria.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            <strong className="text-[var(--white)]">3-tab shingles</strong> are
            a single layer of material — roughly 60 mil thick. Hail impacts
            press through the thin construction and produce clearly visible
            circular marks. Granule displacement is pronounced because there is
            no second laminate layer to absorb energy. A 1-inch hailstone
            striking a 3-tab shingle at terminal velocity can punch entirely
            through the granule and asphalt layers, leaving the fiberglass mat
            exposed. Damage is relatively easy to see and photograph, which is
            why 3-tab hail claims tend to receive faster carrier approval.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            <strong className="text-[var(--white)]">
              Architectural (dimensional) shingles
            </strong>{" "}
            use two or more laminated layers bonded together, producing a
            thicker profile (typically 120-140 mil). The additional mass absorbs
            and distributes hail impact energy across a wider area. Damage often
            appears as a soft depression rather than an obvious crater. Granules
            may remain partially in place, masking the hit. The fiberglass mat
            beneath, however, fractures just as readily. Adjusters who are not
            trained on laminated shingle damage patterns may undercount hits
            because the visual signature is subtler. This is where the bruise
            test becomes critical — pressing into the suspected hit reveals the
            spongy mat fracture that surface inspection alone may miss.
          </p>

          <div className="glass-card p-6 my-8">
            <p className="text-sm text-[var(--gray)] leading-relaxed">
              <strong className="text-[var(--white)]">
                Field identification tip:
              </strong>{" "}
              On a 3-tab roof, look for dark circles with clean edges against
              the lighter granule surface. On architectural roofs, look for
              subtle color variations — slightly darker patches where granules
              are cracked or shifted rather than fully removed. Run your hand
              across the shingle surface; hail hits on dimensional shingles feel
              like dips in the surface even when granule loss is minimal.
            </p>
          </div>

          {/* Section 3 — The Chalk Test */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-4">
            The Chalk Test: Making Invisible Damage Visible
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            The chalk test is the industry-standard field method for confirming
            granule displacement on asphalt shingles. It works because intact
            granules deflect chalk while exposed asphalt absorbs it.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            <strong className="text-[var(--white)]">How to perform it:</strong>{" "}
            Take a piece of standard sidewalk chalk (white or yellow for
            maximum contrast) and rub it lightly across a suspected hail impact
            area in a single pass. Where granules are missing or displaced, the
            chalk fills the exposed asphalt surface and leaves a bright mark.
            Surrounding undamaged granules resist the chalk and remain their
            original color. The result is a clearly defined bright circle or
            irregular shape that stands out in photographs.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            The chalk test is particularly valuable on darker shingles where
            granule loss is difficult to see with the naked eye. It is also
            useful for documenting damage density — chalking every hit within a
            10-foot-by-10-foot test square and then photographing the area from
            above provides an immediate count that adjusters and carriers
            recognize as standard methodology.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Insurance adjusters use the chalk test during their own inspections.
            Providing chalk-marked documentation in your claim package
            demonstrates that your field methodology matches industry practice,
            increasing the credibility of your damage count.
          </p>

          {/* Section 4 — The Bruise Test */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-4">
            The Bruise Test: Detecting Mat Fracture Beneath the Surface
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            While the chalk test reveals granule displacement on the surface,
            the bruise test detects the structural damage that matters most to
            shingle longevity — fractured fiberglass mat.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            <strong className="text-[var(--white)]">How to perform it:</strong>{" "}
            Place your thumb directly on a suspected hail impact and press
            firmly downward. A hail-damaged area feels noticeably softer and
            spongier than the surrounding undamaged shingle surface. The mat
            beneath has fractured, creating a localized area that gives under
            pressure. Compare the feel to an adjacent area that was not hit —
            the difference is unmistakable once you know what to look for.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            The bruise test is critical on architectural shingles where
            granule loss may be minimal. A hit that appears cosmetically
            insignificant from a distance may have completely fractured the
            fiberglass mat, compromising the shingle&apos;s ability to shed
            water and resist wind uplift. Carriers that argue damage is
            &quot;cosmetic only&quot; are rebutted by bruise test
            documentation showing structural compromise beneath the surface.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            When documenting the bruise test, take a close-up photo of your
            thumb pressing into the impact area alongside a photo of the same
            pressure applied to an undamaged section. The visual comparison of
            surface depression makes the structural difference clear in claim
            documentation.
          </p>

          <div className="glass-card p-6 my-8">
            <p className="text-sm text-[var(--gray)] leading-relaxed">
              <strong className="text-[var(--white)]">
                Why mat fracture matters:
              </strong>{" "}
              A shingle with a fractured fiberglass mat loses its rated wind
              resistance, becomes vulnerable to moisture infiltration through
              microcracks, and will deteriorate at an accelerated rate. ARMA
              (Asphalt Roofing Manufacturers Association) acknowledges that mat
              fracture constitutes functional damage regardless of whether
              granule loss is visible.
            </p>
          </div>

          {/* Section 5 — Granule Displacement Patterns */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-4">
            Granule Displacement Patterns: Reading the Evidence
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Hail impacts create distinctive granule displacement patterns that
            trained inspectors can read like a map. Understanding these patterns
            separates legitimate hail damage from other forms of granule loss.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            A direct hail impact displaces granules outward from the center of
            the strike in a roughly circular pattern. The center of the impact
            zone shows the greatest granule loss — often exposing bare asphalt
            mat — while the surrounding ring may show cracked, loosened, or
            partially displaced granules. On steep-slope roofs, the displacement
            pattern skews slightly downslope as gravity assists granule
            movement after impact.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Granule displacement from hail also leaves a &quot;splash
            ring&quot; — a faint circle of concentrated loose granules
            surrounding the impact site. This ring is visible on lighter-colored
            shingles and in close-up photography. Adjusters trained in forensic
            identification look for splash rings as confirmation that impact
            energy was applied from above rather than from foot traffic, tool
            drops, or other non-hail causes.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Excessive granule accumulation in gutters and at the base of
            downspouts after a hailstorm indicates widespread granule
            displacement across the roof surface. While some granule loss is
            normal over a shingle&apos;s life, a sudden spike in gutter granule
            volume after a documented hail event provides supporting evidence
            for a claim.
          </p>

          {/* Section 6 — Random vs Pattern Damage */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-4">
            Random vs. Pattern Damage: The Hallmark of Hail
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            The single most important characteristic of hail damage is
            randomness. Hailstones within a storm cell vary in size, fall at
            different angles as wind shifts, and strike different parts of the
            roof surface at unpredictable intervals. This produces a random
            scatter pattern of hits across the roof — no two impacts are equally
            spaced, equally sized, or aligned in rows.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Contrast this with damage patterns from other sources. Foot traffic
            damage concentrates along walking paths between HVAC units or roof
            penetrations. Tree branch abrasion follows the arc of overhanging
            limbs. Manufacturing defects repeat at regular intervals matching
            the production process. Blistering clusters in areas with the
            greatest sun exposure. Only hail produces random, roof-wide damage
            that follows no structural or environmental pattern.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Within the randomness, hail damage does exhibit a directional trend.
            Because storms have a prevailing wind direction, the windward-facing
            slopes of a roof typically sustain more hits than leeward slopes.
            Documenting hit density on all roof faces — and showing higher
            density on the storm-facing slope — provides directional evidence
            that ties damage to a specific weather event.
          </p>

          <div className="glass-card p-6 my-8">
            <p className="text-sm text-[var(--gray)] leading-relaxed">
              <strong className="text-[var(--white)]">
                Adjuster methodology:
              </strong>{" "}
              Standard insurance inspection protocol counts hail hits within a
              10&prime; &times; 10&prime; test square on each roof slope. Eight
              or more hits per test square on any slope generally meets the
              threshold for full slope replacement. Fewer than eight hits may
              still warrant replacement depending on carrier guidelines and
              local building codes.
            </p>
          </div>

          {/* Section 7 — Differentiating from Blistering/Aging/Defects */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-4">
            How to Differentiate Hail Damage From Blistering, Aging &amp;
            Manufacturing Defects
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Carriers routinely argue that reported hail damage is actually
            pre-existing wear, blistering, or a manufacturing defect. Knowing
            the differences is essential for building claims that survive
            carrier scrutiny.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            <strong className="text-[var(--white)]">Blistering</strong> occurs
            when trapped moisture or volatile compounds within the shingle
            expand under heat, creating raised bumps on the surface. Blisters
            have intact granules on top of the raised area (the bubble pushes
            granules upward, it does not displace them). Hail impacts, by
            contrast, push granules outward and downward. If you can see
            granules sitting on top of a raised bump, it is a blister, not a
            hail hit.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            <strong className="text-[var(--white)]">Normal aging</strong> causes
            uniform granule loss across the entire roof surface, concentrated in
            water-flow channels (the keyways between tabs and the drip edges of
            laminated shingles). Aging loss is gradual and shows a consistent
            fade pattern. Hail loss is sudden, random, and creates discrete
            impact zones rather than uniform wear.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            <strong className="text-[var(--white)]">
              Manufacturing defects
            </strong>{" "}
            follow repeating patterns tied to the production line. Defects
            appear in the same relative position on multiple shingles across the
            roof — every third shingle, every fifth course, or in a consistent
            edge pattern. This regularity is absent from hail damage.
            Manufacturers maintain lot records that allow defect patterns to be
            traced to specific production runs.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            <strong className="text-[var(--white)]">
              Foot traffic and mechanical damage
            </strong>{" "}
            produces scuff marks with directional granule displacement (granules
            pushed in the direction of foot movement). Hail impacts displace
            granules radially outward from the impact center, not in a single
            direction. Scuff marks also tend to be elongated, not circular.
          </p>

          <div className="glass-card p-6 my-8">
            <div className="text-sm text-[var(--gray-muted)] uppercase font-bold tracking-wide mb-2">
              Quick Differentiation Table
            </div>
            <div className="text-sm text-[var(--gray)] leading-relaxed space-y-2">
              <p>
                <strong className="text-[var(--white)]">Hail:</strong> Random
                placement, circular shape, radial granule displacement,
                spongy mat beneath, collateral metal damage
              </p>
              <p>
                <strong className="text-[var(--white)]">Blistering:</strong>{" "}
                Raised bubble, granules intact on top, clustered in
                high-heat areas, no collateral damage
              </p>
              <p>
                <strong className="text-[var(--white)]">Aging:</strong> Uniform
                loss, concentrated in water channels, gradual progression,
                no soft spots
              </p>
              <p>
                <strong className="text-[var(--white)]">Defect:</strong>{" "}
                Repeating pattern, same position on multiple shingles,
                traceable to production lot
              </p>
              <p>
                <strong className="text-[var(--white)]">Foot traffic:</strong>{" "}
                Directional scuffs, elongated marks, along walking paths
              </p>
            </div>
          </div>

          {/* Section 8 — Impact Resistance Ratings */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-4">
            Impact Resistance Ratings: UL 2218 Class 1 Through Class 4
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            The UL 2218 standard (Standard for Impact Resistance of Prepared
            Roof Covering Materials) rates shingles on their ability to
            withstand simulated hail impact. Ratings range from Class 1
            (minimal resistance) to Class 4 (highest resistance), based on
            dropping steel balls of increasing size onto shingle samples.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            <strong className="text-[var(--white)]">Class 1:</strong> Withstands
            a 1.25-inch steel ball dropped from 12 feet. Standard 3-tab
            shingles fall into this category. These shingles are the most
            vulnerable to hail and show the most obvious damage from storms
            with 1-inch or larger hailstones.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            <strong className="text-[var(--white)]">Class 2:</strong> Withstands
            a 1.5-inch steel ball dropped from 15 feet. Mid-grade architectural
            shingles typically achieve this rating.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            <strong className="text-[var(--white)]">Class 3:</strong> Withstands
            a 1.75-inch steel ball dropped from 17 feet. Premium architectural
            shingles from major manufacturers meet this threshold.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            <strong className="text-[var(--white)]">Class 4:</strong> Withstands
            a 2-inch steel ball dropped from 20 feet. This is the highest
            rating and is achieved by specialized impact-resistant shingles
            using SBS (Styrene-Butadiene-Styrene) modified asphalt. Class 4
            shingles qualify for insurance premium discounts in many
            hail-prone states — typically 10-28% off dwelling coverage premiums
            in Texas, Colorado, Oklahoma, Kansas, and Nebraska.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Impact ratings matter for claims because a Class 1 shingle damaged
            by 1.5-inch hail is an expected failure, not an anomaly. Carriers
            cannot argue that the shingle &quot;should have&quot; withstood the
            event if the hail size exceeded the shingle&apos;s rated
            resistance. Citing the UL 2218 class rating alongside documented
            hail size from weather data creates a straightforward causation
            argument in your claim.
          </p>

          <div className="glass-card p-6 my-8">
            <div className="text-sm text-[var(--gray-muted)] uppercase font-bold tracking-wide mb-2">
              UL 2218 Impact Ratings Summary
            </div>
            <p className="text-sm text-[var(--gray)] leading-relaxed">
              <strong className="text-[var(--white)]">Class 1:</strong>{" "}
              1.25&quot; ball / 12 ft &mdash;{" "}
              <strong className="text-[var(--white)]">Class 2:</strong>{" "}
              1.5&quot; ball / 15 ft &mdash;{" "}
              <strong className="text-[var(--white)]">Class 3:</strong>{" "}
              1.75&quot; ball / 17 ft &mdash;{" "}
              <strong className="text-[var(--white)]">Class 4:</strong>{" "}
              2&quot; ball / 20 ft. Each class upgrades hail resistance, with
              Class 4 qualifying for insurance premium discounts up to 28% in
              hail-prone states.
            </p>
          </div>

          {/* Section 9 — Documenting for Insurance */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-4">
            Documenting Asphalt Shingle Hail Damage for Insurance Claims
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Insurance carriers evaluate shingle hail claims using standardized
            criteria. Your documentation must match their methodology to
            achieve approval. Start with wide-angle overview photographs that
            establish the roof&apos;s overall condition and slope orientation
            relative to the storm direction.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Next, document 10&prime; &times; 10&prime; test squares on each
            roof slope. Mark every hail hit within the square using chalk,
            then photograph the entire square from directly above to show
            density. Count and record the number of hits per square.
            Photograph individual impacts at close range (6-12 inches away)
            showing granule displacement detail, and include a reference object
            (coin, pen) for scale.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Document collateral damage — dented gutters, damaged roof vents,
            pitted HVAC equipment, and soft metal dimples on flashing. These
            items confirm a hail event independently of the shingle damage
            and prevent carriers from attributing roof damage to non-hail
            causes. Photograph all four sides of the property, including
            fence caps, mailboxes, and window screens — any soft surface that
            records hail impact.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Include weather data from NOAA storm reports, local weather station
            records, and hail reporting apps that document hail size, duration,
            and wind direction for the event date. Tying your damage
            documentation to verified weather records creates a timeline that
            carriers cannot dispute.
          </p>

          {/* Section 10 — Xactimate Codes */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-4">
            Xactimate Codes for Asphalt Shingle Hail Damage
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Xactimate is the estimating software used by the majority of
            insurance carriers to price roof repairs and replacements. Using
            the correct Xactimate line items in your estimate ensures your
            claim speaks the carrier&apos;s language and avoids back-and-forth
            disputes over scope.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Key Xactimate categories for asphalt shingle hail claims include
            RFG (Roofing) codes for shingle tear-off and replacement, broken
            down by shingle type and quality. RFG LAMI covers laminated
            (architectural) shingle replacement. RFG 3TB covers 3-tab shingle
            replacement. Ridge cap, starter strip, and hip shingle line items
            are separate from field shingle square footage.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Ice and water shield (I&amp;WS) underlayment in eave and valley
            areas is code-required in most jurisdictions and should be
            included in every full replacement estimate. Drip edge metal, step
            flashing, and pipe boot replacement are commonly overlooked line
            items that carriers owe when a full re-roof is triggered by hail.
            Waste factor (typically 10-15% depending on roof complexity) is a
            standard Xactimate allowance that should be included in material
            calculations.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            Building code upgrade line items apply when the replacement must
            meet current code standards that exceed the original installation.
            If the original roof used organic-mat shingles (discontinued) or
            lacked ice and water shield in valleys, the replacement must
            include modern materials and installations — and the carrier owes
            the code-required upgrade cost.
          </p>

          <div className="glass-card p-6 my-8">
            <p className="text-sm text-[var(--gray)] leading-relaxed">
              <strong className="text-[var(--white)]">
                Estimate accuracy matters:
              </strong>{" "}
              Claims submitted with properly coded Xactimate estimates settle{" "}
              <strong className="text-[var(--white)]">40-60% faster</strong>{" "}
              than claims with generic contractor bids. Carriers process
              Xactimate estimates through automated comparison systems — a
              properly coded estimate requires minimal adjuster intervention.
            </p>
          </div>

          {/* Section 11 — dumbroof.ai Analysis */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-4">
            How dumbroof.ai Analyzes Asphalt Shingle Hail Photos
          </h2>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            dumbroof.ai&apos;s AI forensic analysis is purpose-built for the
            damage patterns found on asphalt shingles — the most common
            material in our processed claims. When you upload inspection photos,
            the platform performs several specialized analyses.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            <strong className="text-[var(--white)]">
              Granule displacement detection:
            </strong>{" "}
            AI identifies individual impact sites by recognizing the circular
            granule loss pattern and exposed asphalt mat signature that
            distinguishes hail hits from blistering, scuffing, or aging.
            Each detected hit is annotated in the forensic report with a
            confidence score.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            <strong className="text-[var(--white)]">
              Impact density calculation:
            </strong>{" "}
            The platform calculates hits per test square from your
            photographs, providing the quantitative density data that
            adjusters use to determine replacement eligibility. Higher density
            counts strengthen the case for full slope or full roof replacement.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            <strong className="text-[var(--white)]">
              Directional swath analysis:
            </strong>{" "}
            By comparing damage density across different roof slopes in your
            photos, dumbroof.ai identifies the hail swath direction and
            correlates it with NOAA weather data to establish causation
            between a specific storm event and the documented damage.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-4">
            <strong className="text-[var(--white)]">
              Damage differentiation:
            </strong>{" "}
            The AI flags damage that may be contested as blistering, aging, or
            mechanical damage and provides forensic reasoning for why each
            flagged hit qualifies as hail — citing granule displacement
            direction, mat condition, and pattern randomness as supporting
            evidence.
          </p>
          <p className="text-[var(--gray)] leading-relaxed mb-8">
            The platform generates five deliverables from your uploaded photos:
            a forensic causation report with annotated images, an
            Xactimate-style estimate with applicable RFG codes and building
            code citations, a carrier comparison letter, a supplement request
            letter, and a branded cover email. All five documents are
            delivered in under 15 minutes.
          </p>

          {/* FAQ Section */}
          <h2 className="text-2xl font-bold text-[var(--white)] mt-14 mb-6">
            Frequently Asked Questions
          </h2>
          <div className="space-y-6 mb-14">
            {faqSchema.mainEntity.map(
              (
                faq: {
                  name: string;
                  acceptedAnswer: { text: string };
                },
                i: number,
              ) => (
                <div
                  key={i}
                  className="border-l-2 border-white/10 pl-6 py-2"
                >
                  <h3 className="text-base font-bold text-[var(--white)] mb-2">
                    {faq.name}
                  </h3>
                  <p className="text-[var(--gray)] text-sm leading-relaxed">
                    {faq.acceptedAnswer.text}
                  </p>
                </div>
              ),
            )}
          </div>

          {/* Internal Links */}
          <div className="glass-card p-6 mb-10">
            <h3 className="text-lg font-bold text-[var(--white)] mb-4">
              Related Learning Resources
            </h3>
            <div className="grid sm:grid-cols-2 gap-3">
              {[
                {
                  href: "/learn/what-is-hail-damage",
                  label: "What Is Hail Damage?",
                },
                {
                  href: "/learn/hail-damage-to-tpo-roofing",
                  label: "Hail Damage to TPO Roofing",
                },
                {
                  href: "/learn/hail-damage-to-epdm-roofing",
                  label: "Hail Damage to EPDM Roofing",
                },
                {
                  href: "/learn/hail-damage-to-slate-roofs",
                  label: "Hail Damage to Slate Roofs",
                },
              ].map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="flex items-center gap-2 text-[var(--gray)] hover:text-white font-medium transition-colors group"
                >
                  <span>{link.label}</span>
                  <span className="group-hover:translate-x-1 transition-transform">
                    &rarr;
                  </span>
                </a>
              ))}
            </div>
          </div>

          {/* CTA */}
          <div className="glass-card p-8 mb-10 text-center">
            <h3 className="text-xl font-bold text-[var(--white)] mb-3">
              Stop Guessing. Start Proving Shingle Hail Damage.
            </h3>
            <p className="text-[var(--gray)] mb-6 max-w-xl mx-auto">
              Upload your asphalt shingle inspection photos and get 5
              forensic-grade claim documents in under 15 minutes — annotated
              photos, Xactimate estimate, causation report, and more.
            </p>
            <a
              href="/signup"
              className="inline-flex items-center gap-2 bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white font-semibold py-3 px-8 rounded-xl transition-colors"
            >
              Try 3 Free Claims &rarr;
            </a>
            <p className="text-xs text-[var(--gray-dim)] mt-3">
              No credit card required
            </p>
          </div>

          {/* Footer timestamp */}
          <div className="border-t border-white/10 pt-6 text-center text-[var(--gray-muted)] text-xs">
            <p>
              Last updated: April 3, 2026 &middot; All statistics based on
              industry data, IBHS research, and UL 2218 testing standards
            </p>
          </div>
        </article>
        <Footer />
      </main>
    </>
  );
}
