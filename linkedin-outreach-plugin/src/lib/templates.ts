import type { Language } from './types';

const TEMPLATES = {
  EXPLORATION_IT:
    '[Saluto] [Nome], sto facendo una ricerca sui processi logistici. Lavoro alla creazione di startup all’interno di Vento, il venture capital di Exor. Il suo profilo mi sembra particolarmente rilevante sul tema: le andrebbe una call per confrontarci su frizioni operative e possibili miglioramenti?',
  EXPLORATION_EN:
    "[Greeting] [Nome], I'm conducting research on logistics processes. I'm working on creating startups within Vento, Exor's venture capital arm. Your profile seems particularly relevant to the topic: would you be up for a call to discuss operational frictions and potential improvements?"
};

export function sanitizeName(rawName: string): string {
  return rawName.replace(/["']/g, '').trim().split(/\s+/)[0] ?? '';
}

function greetingsByHour(hour: number) {
  let greetingIT = 'Buongiorno';
  if (hour >= 14 && hour < 18) greetingIT = 'Buon pomeriggio';
  else if (hour >= 18) greetingIT = 'Buonasera';

  let greetingEN = 'Good morning';
  if (hour >= 12 && hour < 18) greetingEN = 'Good afternoon';
  else if (hour >= 18) greetingEN = 'Good evening';

  return { greetingIT, greetingEN };
}

export function buildTemplate(language: Language, firstName: string): string {
  const template = language === 'IT' ? TEMPLATES.EXPLORATION_IT : TEMPLATES.EXPLORATION_EN;
  const { greetingIT, greetingEN } = greetingsByHour(new Date().getHours());

  return template
    .replace('[Nome]', firstName)
    .replace('[Saluto]', greetingIT)
    .replace('[Greeting]', greetingEN);
}
