import type {
  LogLine,
  NarrativeChapter,
  ReportListResponse,
  ReportResponse,
  ReportStats,
} from '../../../api/generated';
import {
  RACE_ENGINE_FAIL_LEG,
  RACE_FRIEND_LEGS,
  RACE_PILOT_LEGS,
  routeOf,
  SANDBOX_WORLD,
} from './sandbox-world';
import { typeOf } from './sandbox-offers';
import type { Sandbox, SandboxResult } from './sandbox-state';

/*
 * The reports of the opening's trips, in the three views the real Report screen reads (summary, narrative, log). They
 * are written from what the sandbox did: where the ship went, what it was paid, and, on the race, who finished where.
 */

const FRIEND_LEGS = RACE_FRIEND_LEGS;
const PILOT_LEGS = RACE_PILOT_LEGS;

type Say = (en: string, pt: string) => string;

const line = (text: string) => ({ text, segments: [{ t: 'text' as const, value: text }] });

function placeName(sandbox: Sandbox, id: string, say: Say): string {
  const place = SANDBOX_WORLD.locations.find((location) => location.id === id);
  return place === undefined ? id : say(place.displayName.en, place.displayName['pt-BR']);
}

function statsOf(sandbox: Sandbox, result: SandboxResult): ReportStats {
  const distance = result.job.routes.reduce((sum, id) => sum + (routeOf(id)?.distance ?? 0), 0);
  const friend = sandbox.config.friendName ?? 'Bob';
  const total = (legs: readonly number[]) => legs.reduce((sum, seconds) => sum + seconds, 0);
  const lost = result.outcome === 'failure';
  const hurt = result.damage ?? [];
  return {
    credits: result.paid,
    balanceAfter: null,
    legs: result.job.routes.length,
    distance,
    // the pirates are active on the second run: the flight slips away from them, but not unhurt
    fights: { won: 0, lost: lost ? 1 : 0, escaped: hurt.length > 0 ? 1 : 0, drawn: 0, pvp: 0 },
    damage: {
      shield: 0,
      armor: 0,
      hull: lost ? 40 : hurt.reduce((sum, part) => sum + (part.before - part.after), 0),
    },
    travelWear: { points: 0, parts: 0 },
    hasShield: false,
    partsDamage: hurt.map((part) => ({
      partId: part.partId,
      partType: part.partType,
      name: part.name.en,
      before: part.before,
      after: part.after,
    })),
    partFailures: 0,
    fuelLost: 0,
    found: [],
    pirates: { stolenParts: 0, motive: null },
    race:
      result.job.kind === 'race'
        ? {
            place: 2,
            timeScale: 1,
            standings: [
              { name: friend, mobility: 3.5, seconds: total(FRIEND_LEGS), you: false },
              { name: 'you', mobility: 3, seconds: total(PILOT_LEGS), you: true },
            ],
            legs: [0, 1, 2].map((leg) => {
              const them = FRIEND_LEGS.slice(0, leg + 1).reduce((sum, seconds) => sum + seconds, 0);
              const you = PILOT_LEGS.slice(0, leg + 1).reduce((sum, seconds) => sum + seconds, 0);
              return {
                standings: [
                  {
                    name: friend,
                    you: false,
                    legSeconds: FRIEND_LEGS[leg] ?? 0,
                    totalSeconds: them,
                    trouble: false,
                  },
                  {
                    name: 'you',
                    you: true,
                    legSeconds: PILOT_LEGS[leg] ?? 0,
                    totalSeconds: you,
                    trouble: leg === RACE_ENGINE_FAIL_LEG,
                  },
                ].sort((a, b) => a.totalSeconds - b.totalSeconds),
              };
            }),
          }
        : null,
    loot: [],
  };
}

function summaryLines(sandbox: Sandbox, result: SandboxResult, say: Say) {
  const to = placeName(sandbox, result.job.destination, say);
  const friend = sandbox.config.friendName ?? 'Bob';
  if (result.outcome === 'failure') {
    return [
      line(
        say(
          `Pirates caught the flight on the way to ${to}.`,
          `Piratas alcançaram o voo a caminho de ${to}.`,
        ),
      ),
      line(
        say(
          'The ship was destroyed. Everyone aboard made it into the escape pods.',
          'A nave foi destruída. Todos a bordo chegaram às cápsulas de fuga.',
        ),
      ),
    ];
  }
  if (result.job.kind === 'race') {
    return [
      line(
        say(
          `You finished second in the race to ${to}, close behind ${friend}.`,
          `Você terminou em segundo na corrida até ${to}, logo atrás de ${friend}.`,
        ),
      ),
      line(say(`Prize: ${result.paid} credits.`, `Prêmio: ${result.paid} créditos.`)),
    ];
  }
  if ((result.damage ?? []).length > 0) {
    return [
      line(
        say(
          `Pirates hit the flight on the way to ${to}. It got through, but the ship took damage.`,
          `Piratas atacaram o voo a caminho de ${to}. Ele passou, mas a nave sofreu danos.`,
        ),
      ),
      line(say(`Paid: ${result.paid} credits.`, `Pago: ${result.paid} créditos.`)),
    ];
  }
  return [
    line(say(`The flight reached ${to} without trouble.`, `O voo chegou a ${to} sem problemas.`)),
    line(say(`Paid: ${result.paid} credits.`, `Pago: ${result.paid} créditos.`)),
  ];
}

function narrativeOf(sandbox: Sandbox, result: SandboxResult, say: Say): NarrativeChapter[] {
  const lost = result.outcome === 'failure';
  return result.job.routes.map((routeId, index) => {
    const route = routeOf(routeId);
    const from = index === 0 ? result.job.origin : (route?.a ?? '');
    const to = index === result.job.routes.length - 1 ? result.job.destination : (route?.b ?? '');
    const last = index === result.job.routes.length - 1;
    const lines = [
      {
        ...line(say('A calm stretch of space.', 'Um trecho calmo do espaço.')),
        category: 'transit',
        type: 'transit',
      },
    ];
    if (result.job.kind === 'race' && index === RACE_ENGINE_FAIL_LEG) {
      lines.push({
        ...line(
          say(
            'The engine coughed and lost power. The ship limped on, and the friend pulled ahead for good.',
            'O motor engasgou e perdeu potência. A nave seguiu mancando, e o amigo disparou na frente.',
          ),
        ),
        category: 'wear',
        type: 'part_failure',
      });
    }
    if (lost && last) {
      lines.push({
        ...line(
          say(
            'Raiders dropped out of the dark and opened fire. The hull gave way.',
            'Saqueadores surgiram do escuro e abriram fogo. O casco cedeu.',
          ),
        ),
        category: 'combat',
        type: 'combat_loss',
      });
    } else if (last && (result.damage ?? []).length > 0) {
      lines.push(
        {
          ...line(
            say(
              'Pirates came out of the dark and opened fire. The ship slipped away, but parts of it are badly worn.',
              'Piratas surgiram do escuro e abriram fogo. A nave escapou, mas partes dela estão muito desgastadas.',
            ),
          ),
          category: 'combat',
          type: 'combat_escape',
        },
        {
          ...line(
            say(
              `Docked at ${placeName(sandbox, result.job.destination, say)}. ${result.paid} credits paid.`,
              `Atracou em ${placeName(sandbox, result.job.destination, say)}. ${result.paid} créditos pagos.`,
            ),
          ),
          category: 'payment',
          type: 'payment',
        },
      );
    } else if (last) {
      lines.push({
        ...line(
          say(
            `Docked at ${placeName(sandbox, result.job.destination, say)}. ${result.paid} credits paid.`,
            `Atracou em ${placeName(sandbox, result.job.destination, say)}. ${result.paid} créditos pagos.`,
          ),
        ),
        category: 'payment',
        type: 'payment',
      });
    }
    return {
      leg: index + 1,
      header: line(`${placeName(sandbox, from, say)} → ${placeName(sandbox, to, say)}`),
      lines,
    };
  });
}

function logOf(sandbox: Sandbox, result: SandboxResult, say: Say): LogLine[] {
  return narrativeOf(sandbox, result, say).flatMap((chapter) =>
    chapter.lines.map((entry) => ({ ...entry, leg: chapter.leg, categoryLabel: entry.category })),
  );
}

export function reportOf(sandbox: Sandbox, missionId: string, view: string): ReportResponse | null {
  const result = sandbox.state.history.find((entry) => entry.id === missionId);
  if (result === undefined) return null;
  const say: Say = (en, pt) => (sandbox.config.profile.locale === 'pt-BR' ? pt : en);
  const base = {
    locale: sandbox.config.profile.locale,
    outcome: result.outcome === 'failure' ? ('failed' as const) : ('success' as const),
    stats: statsOf(sandbox, result),
    mission: {
      type: typeOf(result.job),
      originId: result.job.origin,
      destinationId: result.job.destination,
      reward: result.reward,
      routeIds: [...result.job.routes],
      title: result.job.title,
    },
  };
  if (view === 'narrative') {
    return { ...base, view: 'narrative', chapters: narrativeOf(sandbox, result, say) };
  }
  if (view === 'log') return { ...base, view: 'log', lines: logOf(sandbox, result, say) };
  return { ...base, view: 'summary', lines: summaryLines(sandbox, result, say) };
}

export function reportListOf(sandbox: Sandbox): ReportListResponse {
  return {
    items: [...sandbox.state.history].reverse().map((result) => ({
      missionId: result.id,
      outcome: result.outcome === 'failure' ? ('failed' as const) : ('success' as const),
      credits: result.paid,
      legs: result.job.routes.length,
      createdAt: new Date(result.finishedAt).toISOString(),
      hadCombat: result.outcome === 'failure',
    })),
  };
}
