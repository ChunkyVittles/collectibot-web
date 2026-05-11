import Link from "next/link";

type LinkedEntity = { id: number; name: string };

type Props = {
  totalIssues: number;
  firstYear: number | null;
  lastYear: number | null;
  peakDecade: string | null;
  publisherCount: number;
  topPublishers: LinkedEntity[];   // sorted desc by count
  topCollaborators: LinkedEntity[]; // sorted desc by count, prefiltered to a small N
  topSeries: LinkedEntity[];        // sorted desc by credit count, prefiltered to a small N
};

// Structured "About" prose built from facts we own (not imported GCD bios).
// Server component, no JS payload. Returns null when there's not enough data
// to say anything more useful than the credits table already shows.
export default function CreatorAbout({
  totalIssues,
  firstYear,
  lastYear,
  peakDecade,
  publisherCount,
  topPublishers,
  topCollaborators,
  topSeries,
}: Props) {
  // Skip when the credits table alone already conveys everything we'd say.
  if (totalIssues < 3 && topCollaborators.length < 2) return null;

  const clauses: React.ReactNode[] = [];

  // 1. Active period
  if (firstYear) {
    if (lastYear && lastYear !== firstYear) {
      const spanDecades = Math.floor(lastYear / 10) - Math.floor(firstYear / 10);
      if (peakDecade && spanDecades >= 1) {
        clauses.push(
          <>
            Active from {firstYear} to {lastYear}, primarily in the {peakDecade}.
          </>
        );
      } else {
        clauses.push(<>Active from {firstYear} to {lastYear}.</>);
      }
    } else {
      clauses.push(<>Active in {firstYear}.</>);
    }
  }

  // 2. Credit volume + publishers
  const works = totalIssues === 1 ? "work" : "works";
  if (publisherCount === 1 && topPublishers[0]) {
    clauses.push(
      <>
        Credited on {totalIssues.toLocaleString()} {works} for{" "}
        <Link href={`/publisher/${topPublishers[0].id}`} style={{ color: "inherit" }}>
          {topPublishers[0].name}
        </Link>
        .
      </>
    );
  } else if (publisherCount === 2 && topPublishers.length >= 2) {
    clauses.push(
      <>
        Credited on {totalIssues.toLocaleString()} {works} across two publishers,{" "}
        <Link href={`/publisher/${topPublishers[0].id}`} style={{ color: "inherit" }}>
          {topPublishers[0].name}
        </Link>{" "}
        and{" "}
        <Link href={`/publisher/${topPublishers[1].id}`} style={{ color: "inherit" }}>
          {topPublishers[1].name}
        </Link>
        .
      </>
    );
  } else if (publisherCount >= 3 && topPublishers.length >= 2) {
    clauses.push(
      <>
        Credited on {totalIssues.toLocaleString()} {works} across {publisherCount.toLocaleString()}{" "}
        publishers, most often{" "}
        <Link href={`/publisher/${topPublishers[0].id}`} style={{ color: "inherit" }}>
          {topPublishers[0].name}
        </Link>{" "}
        and{" "}
        <Link href={`/publisher/${topPublishers[1].id}`} style={{ color: "inherit" }}>
          {topPublishers[1].name}
        </Link>
        .
      </>
    );
  } else {
    clauses.push(<>Credited on {totalIssues.toLocaleString()} {works}.</>);
  }

  // 3. Frequent collaborators
  if (topCollaborators.length === 1) {
    clauses.push(
      <>
        Frequent collaborator:{" "}
        <Link href={`/creator/${topCollaborators[0].id}`} style={{ color: "inherit" }}>
          {topCollaborators[0].name}
        </Link>
        .
      </>
    );
  } else if (topCollaborators.length === 2) {
    clauses.push(
      <>
        Frequent collaborators include{" "}
        <Link href={`/creator/${topCollaborators[0].id}`} style={{ color: "inherit" }}>
          {topCollaborators[0].name}
        </Link>{" "}
        and{" "}
        <Link href={`/creator/${topCollaborators[1].id}`} style={{ color: "inherit" }}>
          {topCollaborators[1].name}
        </Link>
        .
      </>
    );
  } else if (topCollaborators.length >= 3) {
    const c = topCollaborators;
    clauses.push(
      <>
        Frequent collaborators include{" "}
        <Link href={`/creator/${c[0].id}`} style={{ color: "inherit" }}>{c[0].name}</Link>
        ,{" "}
        <Link href={`/creator/${c[1].id}`} style={{ color: "inherit" }}>{c[1].name}</Link>
        , and{" "}
        <Link href={`/creator/${c[2].id}`} style={{ color: "inherit" }}>{c[2].name}</Link>
        .
      </>
    );
  }

  // 4. Best known for (top series)
  if (topSeries.length === 1) {
    clauses.push(
      <>
        Best known for{" "}
        <Link href={`/series/${topSeries[0].id}`} style={{ color: "inherit" }}>
          {topSeries[0].name}
        </Link>
        .
      </>
    );
  } else if (topSeries.length === 2) {
    clauses.push(
      <>
        Best known for work on{" "}
        <Link href={`/series/${topSeries[0].id}`} style={{ color: "inherit" }}>
          {topSeries[0].name}
        </Link>{" "}
        and{" "}
        <Link href={`/series/${topSeries[1].id}`} style={{ color: "inherit" }}>
          {topSeries[1].name}
        </Link>
        .
      </>
    );
  } else if (topSeries.length >= 3) {
    const s = topSeries;
    clauses.push(
      <>
        Best known for work on{" "}
        <Link href={`/series/${s[0].id}`} style={{ color: "inherit" }}>{s[0].name}</Link>
        ,{" "}
        <Link href={`/series/${s[1].id}`} style={{ color: "inherit" }}>{s[1].name}</Link>
        , and{" "}
        <Link href={`/series/${s[2].id}`} style={{ color: "inherit" }}>{s[2].name}</Link>
        .
      </>
    );
  }

  // Require at least two clauses for the block to be worth rendering.
  if (clauses.length < 2) return null;

  return (
    <p style={{ color: "#bbb", lineHeight: 1.6, margin: "0 0 24px 0", maxWidth: 640 }}>
      {clauses.map((c, i) => (
        <span key={i}>
          {c}
          {i < clauses.length - 1 ? " " : ""}
        </span>
      ))}
    </p>
  );
}
