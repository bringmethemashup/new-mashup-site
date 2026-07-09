/**
 * moods.js — auto-updating "Made for you" mood playlists.
 *
 * Each mood is a RULE SET (artists / known songs / title keywords) matched
 * against every mashup's source songs, so playlists rebuild themselves on
 * every catalog load: new uploads are absorbed automatically, nothing is
 * stored. The order rotates by ISO week so the shelves feel fresh without
 * the contents jumping around mid-week.
 *
 * Scoring: each source song that hits a rule counts as a match. A mashup
 * joins a mood when enough of its blend matches (default: at least 2 songs
 * AND a third of the blend, or half the blend, or its only song matches).
 */
import { norm, splitArtists } from './catalog.js';

const M = (key, name, emoji, desc, rules) => ({ key, name, emoji, desc, ...rules });

export const MOODS = [
  M('party', 'Party All Night', '🪩', 'Floor-fillers and club bangers', {
    artists: ['kesha', 'black eyed peas', 'lmfao', 'pitbull', 'david guetta', 'calvin harris', 'avicii', 'zedd', 'basshunter', 'cascada', 'far east movement', 'flo rida'],
    songs: ['till the world ends', 'i wanna go', 'starships', 'we r who we r', 'die young', 'crazy kids', "c'mon", 'scream & shout', 'scream and shout', 'just dance', 'get the party started', 'neon lights', 'blow', 'your love is my drug', 'take it off', 'timber', 'wild ones', 'turn me on', 'give me everything', 'on the floor', 'evacuate the dancefloor', 'raise your glass', 'tik tok', 'dynamite', 'dj got us fallin in love', "dj got us fallin' in love", 'party rock anthem', 'sexy and i know it', 'i gotta feeling', 'yeah!', 'get low', 'temperature', 'low', 'right round', 'club can\'t handle me'],
    words: ['party', 'dance', 'dancing', 'dancefloor', 'club', ' dj', 'dj ', 'tonight', 'bounce', 'jump', 'shots', 'loud', 'turn up', 'rave'],
  }),
  M('sadgirl', 'Sad Girl Hours', '🥀', 'Heartbreak, ballads and 3am feelings', {
    artists: ['adele', 'lana del rey', 'billie eilish', 'sia'],
    songs: ['wrecking ball', 'same old love', 'jealous', 'i knew you were trouble', 'chains', 'stay', 'skyscraper', 'apologize', 'say something', 'let her go', 'night changes', 'story of my life', 'someone like you', 'hello', 'when i was your man', 'too little too late', 'big girls don\'t cry', 'because of you', 'behind these hazel eyes', 'my immortal', 'jar of hearts', 'everytime', 'unusual you', 'the one that got away', 'wide awake', 'stone cold', 'sober', 'praying', 'happier', 'when the party\'s over', 'summertime sadness', 'dancing on my own', 'liability', 'all too well', 'back to december', 'white horse', 'a thousand miles'],
    words: ['cry', 'tears', 'sorry', 'hurt', 'alone', 'broken', 'goodbye', 'miss you', 'without you', 'scars', 'gone', 'lonely', 'sad', 'rain', 'heartbreak', 'breathe'],
  }),
  M('beach', 'Beach Day', '🏖️', 'Sun, sand and windows-down summer', {
    artists: [],
    songs: ['good time', "live while we're young", 'cool for the summer', 'california gurls', 'cruel summer', 'watermelon sugar', 'island in the sun', 'kokomo', 'soak up the sun', 'vacation', 'sunroof', 'malibu', 'summertime sadness', 'boys of summer', 'steal my girl', 'rock me', 'what makes you beautiful', 'kiss you', 'one thing', 'cake by the ocean', 'am i wrong', 'rude', 'cheerleader', 'shut up and dance', 'walking on sunshine', 'banana pancakes'],
    words: ['summer', 'sun', 'sunshine', 'beach', 'california', 'island', 'paradise', 'wave', 'ocean', 'sea ', 'tropical', 'heat', 'surf', 'tan ', 'bikini', 'aloha', 'palm'],
  }),
  M('y2k', '2000s Throwback', '💿', 'TRL-era pop — burn it to a CD-R', {
    artists: ['hilary duff', "destiny's child", 'nsync', '*nsync', 'backstreet boys', 'spice girls', 'pussycat dolls', 'gwen stefani', 'ashlee simpson', 'lindsay lohan', 'vanessa carlton', 't.a.t.u.', 's club 7', 'aaron carter', 'jesse mccartney', 'jojo', 'nelly furtado', 'natasha bedingfield', 'fergie', 'sean paul', 'usher', 'ciara', 'aqua', 'eiffel 65'],
    songs: ['toxic', 'gimme more', 'piece of me', 'womanizer', 'circus', 'oops!... i did it again', 'oops i did it again', '...baby one more time', 'baby one more time', "i'm a slave 4 u", 'slave 4 u', 'say my name', 'survivor', 'bootylicious', "jumpin' jumpin'", 'independent women', 'dirrty', 'beautiful', 'genie in a bottle', 'fighter', 'complicated', 'sk8er boi', 'girlfriend', 'hollaback girl', 'rich girl', 'hot in herre', 'yeah!', 'crazy in love', 'single ladies', 'umbrella', 'sos', 'pon de replay', 'promiscuous', 'maneater', 'sexyback', 'cry me a river', 'rock your body', 'since u been gone', 'breakaway', 'behind these hazel eyes', 'mr. brightside', 'i write sins not tragedies', 'when i grow up', 'buttons', "don't cha", '4 minutes', 'hung up', 'die another day', 'come clean', 'so yesterday', 'wake up', 'with love', 'stronger', 'gold digger', 'in da club', 'lose yourself', 'without me', 'the real slim shady', 'bye bye bye', 'it\'s gonna be me', 'i want it that way', 'everybody', 'larger than life', 'wannabe', 'barbie girl', 'blue (da ba dee)', 'all the small things', 'american idiot', 'boulevard of broken dreams', 'numb', 'in the end', 'bring me to life', 'a thousand miles', 'unwritten', 'pocketful of sunshine', 'get busy', 'yeah', 'burn', 'goodies', '1, 2 step'],
    words: [],
  }),
  M('divas', 'Pop Royalty', '👑', 'Wall-to-wall main pop girls', {
    artists: ['britney spears', 'lady gaga', 'madonna', 'rihanna', 'beyonce', 'beyoncé', 'katy perry', 'kesha', 'miley cyrus', 'ariana grande', 'taylor swift', 'dua lipa', 'charli xcx', 'kylie minogue', 'kim petras', 'slayyyter', 'ava max', 'carly rae jepsen', 'demi lovato', 'selena gomez', 'p!nk', 'nicki minaj', 'bebe rexha', 'christina aguilera', 'jade', 'sabrina carpenter', 'chappell roan', 'tate mcrae', 'meghan trainor', 'fifth harmony', 'little mix', 'iggy azalea', 'gwen stefani', 'fergie', 'doechii', 'camila cabello', 'normani', 'lizzo', 'doja cat'],
    songs: [],
    words: [],
    // the identity playlist: only blends that are (nearly) all divas
    qualify: (m, n) => n >= 2 && m / n >= 0.8,
  }),
  M('pump', 'Pump It Up', '💪', 'Gym fuel — no skips, no mercy', {
    artists: [],
    songs: ['work bitch', 'work from home', 'till i collapse', 'eye of the tiger', 'stronger', 'titanium', 'roar', 'fight song', 'hall of fame', 'remember the name', "can't hold us", 'power', 'run the world (girls)', 'run the world', 'confident', 'sorry not sorry', 'lose yourself', 'survivor', 'work it', 'physical', 'harder, better, faster, stronger', 'harder better faster stronger', 'level up', 'salute', 'worth it', 'formation', 'applause', 'unstoppable', 'believer', 'thunder', 'whatever it takes', 'centuries', 'my songs know what you did in the dark', 'radioactive', 'warriors'],
    words: ['work', 'stronger', 'harder', 'fight', 'warrior', 'champion', 'power', 'unstoppable', 'invincible', 'run ', 'sweat', 'hustle'],
  }),
  M('nightdrive', 'Night Drive', '🌙', 'Neon-lit synths for after dark', {
    artists: ['the weeknd'],
    songs: ['where have you been', 'into you', 'disturbia', 'blinding lights', 'midnight city', 'neon lights', 'in the dark', 'dark horse', 'starboy', 'take my breath', 'save your tears', "can't feel my face", 'the hills', 'often', 'earned it', 'streets', 'nightcall', 'i feel it coming', 'midnight sky', 'edge of seventeen', 'bad guy', 'therefore i am', 'love me harder', 'one more night', 'animals', 'maps', 'cool', 'slow hands', 'talking body', 'lights', 'e.t.', 'monster'],
    words: ['night', 'midnight', 'dark', 'neon', 'drive', 'city', 'lights', 'stars', 'moon', '3am', 'late', 'shadow'],
  }),
  M('rockmash', 'Rock the Mash', '🎸', 'When the mashup brings the guitars', {
    artists: ['imagine dragons', 'fall out boy', 'panic! at the disco', 'linkin park', 'hollywood undead', 'paramore', 'my chemical romance', 'all time low', 'green day', 'blink-182', 'evanescence', 'three days grace', 'skillet', 'breaking benjamin', 'the killers', 'twenty one pilots', '30 seconds to mars', 'thirty seconds to mars', 'papa roach', 'system of a down', 'nirvana', 'foo fighters', 'red hot chili peppers', 'queen', 'bon jovi', 'ac/dc', 'guns n\' roses', 'metallica', 'nickelback', 'seether', 'shinedown', 'weezer'],
    songs: [],
    words: [],
    qualify: (m, n) => m >= 1, // one rock act in the blend earns the flag
  }),
];

const defaultQualify = (m, n) => (n === 1 && m === 1) || (m >= 2 && m / n >= 0.34) || m / n >= 0.5;

/* ISO week number — used to rotate shelf order weekly so playlists feel
   refreshed without contents shuffling mid-week. */
function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / 864e5 + 1) / 7);
}

let cache = null, cacheKey = null;

/** [{ key, name, emoji, desc, tracks:[track] }] — memoized per catalog load. */
export function moodPlaylists(tracks) {
  if (cache && cacheKey === tracks) return cache;
  const prepped = MOODS.map((mood) => ({
    mood,
    artists: new Set(mood.artists),
    songs: new Set(mood.songs.map(norm)),
    words: mood.words.map(norm),
    qualify: mood.qualify || defaultQualify,
    picks: [],
  }));
  for (const t of tracks) {
    const ss = t.sourceSongs || [];
    if (!ss.length || t._status === 'pending') continue;
    for (const p of prepped) {
      let m = 0;
      for (const s of ss) {
        const title = norm(s.title || '');
        const hit = splitArtists(s.artist).some((a) => p.artists.has(norm(a)))
          || (title && p.songs.has(title))
          || (title && p.words.some((w) => title.includes(w)));
        if (hit) m++;
      }
      if (m && p.qualify(m, ss.length)) p.picks.push({ t, score: m / ss.length });
    }
  }
  const week = isoWeek();
  cache = prepped.map((p) => {
    p.picks.sort((a, b) => b.score - a.score || (b.t.dateAdded || '').localeCompare(a.t.dateAdded || ''));
    let list = p.picks.map((x) => x.t).slice(0, 75);
    if (list.length > 3) { const off = week % list.length; list = [...list.slice(off), ...list.slice(0, off)]; }
    return { key: p.mood.key, name: p.mood.name, emoji: p.mood.emoji, desc: p.mood.desc, tracks: list };
  }).filter((pl) => pl.tracks.length >= 4);
  cacheKey = tracks;
  return cache;
}
