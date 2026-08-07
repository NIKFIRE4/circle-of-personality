export const DEFAULT_BALANCE_CATEGORIES = [
  {
    name: "Здоровье",
    slug: "health",
    color: "#F0A43A",
    icon: "activity",
    targetMinutesPerWeek: 300,
    sortOrder: 0,
  },
  {
    name: "Карьера",
    slug: "career",
    color: "#D88A2D",
    icon: "briefcase-business",
    targetMinutesPerWeek: 600,
    sortOrder: 1,
  },
  {
    name: "Отношения",
    slug: "relationships",
    color: "#F1D39A",
    icon: "users",
    targetMinutesPerWeek: 240,
    sortOrder: 2,
  },
  {
    name: "Развитие",
    slug: "growth",
    color: "#E5B963",
    icon: "book-open",
    targetMinutesPerWeek: 300,
    sortOrder: 3,
  },
  {
    name: "Финансы",
    slug: "finance",
    color: "#B97831",
    icon: "wallet-cards",
    targetMinutesPerWeek: 120,
    sortOrder: 4,
  },
  {
    name: "Отдых",
    slug: "rest",
    color: "#E8D7B0",
    icon: "moon-star",
    targetMinutesPerWeek: 420,
    sortOrder: 5,
  },
  {
    name: "Творчество",
    slug: "creativity",
    color: "#C88A3D",
    icon: "palette",
    targetMinutesPerWeek: 180,
    sortOrder: 6,
  },
  {
    name: "Окружение",
    slug: "environment",
    color: "#D6D0C5",
    icon: "house",
    targetMinutesPerWeek: 180,
    sortOrder: 7,
  },
] as const;

export type DefaultCategoryGuide = {
  /** Matches the slug in DEFAULT_BALANCE_CATEGORIES. */
  slug: string;
  /** One line answering "what is this sphere for". */
  summary: string;
  /** Readable examples of what belongs here, shown in settings. */
  includes: readonly string[];
  /** Why the starting weekly target is what it is. */
  target: string;
  /** Which published model this sphere comes from. */
  basis: string;
};

/**
 * Why these eight and not any other eight.
 *
 * The starting set is not invented here: it is the intersection of the three
 * frameworks named in BALANCE_MODEL_SOURCES, which independently converge on
 * the same life areas. Every sphere below states which model it comes from, so
 * the defaults can be argued with instead of taken on faith. They are only a
 * starting point — every sphere can be renamed, retargeted or removed.
 */
export const DEFAULT_CATEGORY_GUIDES: readonly DefaultCategoryGuide[] = [
  {
    slug: "health",
    summary: "Тело и его обслуживание: движение, восстановление, медицина.",
    includes: ["тренировки", "бег и бассейн", "йога и растяжка", "врачи и анализы"],
    target:
      "5 часов в неделю — верхняя граница нормы ВОЗ (150–300 минут умеренной активности), плюс запас на визиты к врачу.",
    basis: "Physical and Health у Мейера, Physical Wellbeing у Gallup.",
  },
  {
    slug: "career",
    summary: "Работа как источник смысла и роста, а не просто часы в офисе.",
    includes: ["встречи и созвоны", "работа над проектом", "собеседования", "командировки"],
    target:
      "10 часов в неделю — не весь рабочий день, а та часть, которую вы осознанно планируете и хотите видеть в балансе.",
    basis:
      "Financial and Career у Мейера; у Gallup Career Wellbeing — сильнейший из пяти элементов.",
  },
  {
    slug: "relationships",
    summary: "Близкие люди: семья, друзья, тот круг, который держит вас.",
    includes: ["время с семьёй", "встречи с друзьями", "звонки родителям", "дни рождения"],
    target: "4 часа в неделю — примерно четыре живые встречи или долгих разговора.",
    basis:
      "Family and Home плюс Social and Cultural у Мейера, Social Wellbeing у Gallup, R в модели PERMA.",
  },
  {
    slug: "growth",
    summary: "Обучение и навыки — то, чего вы не умели полгода назад.",
    includes: ["курсы и лекции", "языки", "чтение", "практика нового навыка"],
    target: "5 часов в неделю — около часа в будний день.",
    basis:
      "Mental and Education у Мейера; Engagement и Accomplishment в модели PERMA.",
  },
  {
    slug: "finance",
    summary: "Управление деньгами: не заработок, а решения о нём.",
    includes: ["бюджет и учёт", "платежи и налоги", "инвестиции", "страховки"],
    target:
      "2 часа в неделю — этого хватает на регулярный разбор бюджета без превращения его в работу.",
    basis: "Financial and Career у Мейера, Financial Wellbeing у Gallup.",
  },
  {
    slug: "rest",
    summary: "Осознанное восстановление, а не остаток времени после всего.",
    includes: ["прогулки", "кино и театр", "выходные без планов", "отпуск и поездки"],
    target:
      "7 часов в неделю — час в день. Сон сюда не входит: это отдельная величина, которую не нужно планировать в календаре.",
    basis:
      "Восстановительная часть Physical у Мейера и Positive Emotion в модели PERMA.",
  },
  {
    slug: "creativity",
    summary: "Занятия, которые вы делаете ради самого процесса.",
    includes: ["музыка", "рисование и фото", "письмо", "рукоделие"],
    target: "3 часа в неделю — обычно два-три полноценных подхода.",
    basis:
      "Engagement (состояние потока) в модели PERMA; Social and Cultural у Мейера.",
  },
  {
    slug: "environment",
    summary: "Быт и место, в котором проходит жизнь.",
    includes: ["уборка и готовка", "покупки", "ремонт и техника", "дача и двор"],
    target: "3 часа в неделю — регулярный быт, а не разовые авралы.",
    basis: "Family and Home у Мейера, Community Wellbeing у Gallup.",
  },
];

export type BalanceModelSource = {
  title: string;
  detail: string;
  url: string;
};

export const BALANCE_MODEL_SOURCES: readonly BalanceModelSource[] = [
  {
    title: "Колесо жизни Пола Дж. Мейера, 1960-е",
    detail:
      "Исходная модель из Success Motivation Institute: Family and Home, Financial and Career, Mental and Education, Physical and Health, Social and Cultural, Spiritual and Ethical.",
    url: "https://www.thecoachingtoolscompany.com/wheel-of-life-complete-guide-everything-you-need-to-know/",
  },
  {
    title: "Gallup, «Wellbeing: The Five Essential Elements», 2010",
    detail:
      "Опрос в более чем 150 странах выделил пять элементов благополучия: Career, Social, Financial, Physical, Community.",
    url: "https://www.gallup.com/workplace/237020/five-essential-elements.aspx",
  },
  {
    title: "Мартин Селигман, модель PERMA, «Flourish», 2011",
    detail:
      "Пять измеримых опор благополучия: положительные эмоции, вовлечённость, отношения, смысл, достижения.",
    url: "https://en.wikipedia.org/wiki/PERMA_model",
  },
  {
    title: "ВОЗ, рекомендации по физической активности, 2020",
    detail:
      "150–300 минут умеренной активности в неделю для взрослых — отсюда недельная цель сферы «Здоровье».",
    url: "https://www.who.int/news-room/fact-sheets/detail/physical-activity",
  },
];

/**
 * Шестая сфера Мейера, Spiritual and Ethical, намеренно не включена: она
 * слишком лична, чтобы предлагать её по умолчанию. Её можно добавить вручную.
 */
export const OMITTED_SPHERE_NOTE =
  "Шестая сфера Мейера — «духовное и этическое» — намеренно не включена: она слишком лична для значения по умолчанию. Добавьте её сами, если она вам нужна.";

const GUIDES_BY_SLUG = new Map(
  DEFAULT_CATEGORY_GUIDES.map((guide) => [guide.slug, guide]),
);

export function defaultCategoryGuide(
  slug: string,
): DefaultCategoryGuide | undefined {
  return GUIDES_BY_SLUG.get(slug);
}

/**
 * Word stems the offline classifier matches against event titles.
 *
 * Kept next to the guides on purpose: what the settings screen promises lands
 * in a sphere and what the classifier actually puts there must not drift apart.
 * Stems are lowercase with ё folded to е, and are matched as substrings, so
 * they must stay long enough not to fire on unrelated words.
 */
export const DEFAULT_CATEGORY_KEYWORDS: Readonly<
  Record<string, readonly string[]>
> = {
  health: [
    "трениров", "спорт", "фитнес", "зал", "тренаж", "бег", "пробежк", "йог",
    "пилатес", "бассейн", "плаван", "велосипед", "лыж", "коньк", "бокс",
    "борьб", "кроссфит", "турник", "зарядк", "растяжк", "лфк", "массаж",
    "врач", "доктор", "поликлиник", "больниц", "клиник", "стоматолог", "зубн",
    "анализ", "узи", "мрт", "прививк", "терапевт", "офтальмолог", "диспансер",
    "здоров", "шаги", "физио",
  ],
  career: [
    "работ", "карьер", "офис", "проект", "клиент", "заказчик", "собеседован",
    "интервью", "стажиров", "совещан", "планерк", "летучк", "созвон", "митинг",
    "стендап", "спринт", "ретро", "дедлайн", "отчет", "презентац", "демо",
    "релиз", "деплой", "командировк", "переговор", "договор", "контракт",
    "смена", "дежурств", "подряд", "тимлид", "one-on-one", "1:1",
  ],
  relationships: [
    "семь", "жена", "муж", "супруг", "родител", "мама", "мамой", "папа",
    "папой", "бабушк", "дедушк", "сын", "дочь", "дет", "ребен", "брат",
    "сестр", "друзь", "дружб", "подруг", "приятел", "свидан", "отношен",
    "день рожден", "годовщин", "свадьб", "гост", "семейн", "родн", "крестин",
    "ужин с", "обед с", "кофе с", "встреча с",
  ],
  growth: [
    "учеб", "курс", "урок", "лекци", "семинар", "вебинар", "тренинг",
    "мастер-класс", "воркшоп", "практикум", "читать", "чтени", "книг",
    "английск", "испанск", "немецк", "французск", "китайск", "язык",
    "репетитор", "экзамен", "зачет", "сесси", "диплом", "диссертац",
    "универ", "институт", "школ", "обучен", "развити", "конспект", "домашк",
    "сертификац", "подкаст", "конференц",
  ],
  finance: [
    "финанс", "бюджет", "банк", "счет", "налог", "оплат", "платеж",
    "инвестиц", "брокер", "вклад", "депозит", "кредит", "ипотек", "страхов",
    "декларац", "бухгалт", "зарплат", "расход", "накоплен", "портфел",
    "пенси", "субсиди",
  ],
  rest: [
    "отдых", "отдохн", "выспат", "кино", "фильм", "сериал", "театр",
    "концерт", "выставк", "музе", "прогулк", "гулять", "отпуск", "каникул",
    "выходн", "баня", "сауна", "спа", "кафе", "ресторан", "бар", "пикник",
    "поход", "путешеств", "поездк", "перелет", "рейс", "отель", "игр",
    "приставк", "настолк",
  ],
  creativity: [
    "рисова", "живопис", "скетч", "музык", "гитар", "пианино", "фортепиано",
    "вокал", "пени", "хор", "барабан", "творч", "фото", "фотосесс", "лепк",
    "керамик", "гончар", "вязан", "шить", "рукодел", "дизайн", "макет",
    "иллюстрац", "монтаж", "видео", "блог", "танц", "репетиц", "студи",
    "писать",
  ],
  environment: [
    "дом", "уборк", "убрат", "ремонт", "покупк", "продукт", "магазин",
    "супермаркет", "доставк", "переезд", "быт", "стирк", "готовк", "готовить",
    "кухн", "посуд", "мусор", "дача", "сад", "огород", "коммунал", "жкх",
    "сантехник", "электрик", "шиномонтаж", "техосмотр", "автосервис", "мойк",
    "парикмахер", "стрижк", "маникюр", "барбершоп", "окружен",
  ],
};

/** Lowercases and folds ё so keyword stems only need one spelling. */
export function normalizeCategoryMatchText(text: string): string {
  return text.toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
}
