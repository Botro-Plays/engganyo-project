"""Hand-written basics for the languages that have no offline translation model (Kazakh, Uzbek, Somali, Serbian, Amharic, Kurdish, Sinhala).

Buttons, navigation, the Main menu and the prompts are translated; long menu texts stay English until a translation file exists
(`tools/build_locales.py`). The language picker marks these languages "·Basic".
"""
from __future__ import annotations

ORDER = ("kk", "uz", "uz-cyr", "so", "sr", "am", "ku", "si")
_ROWS = [
    # english           kk               uz              uz-cyr          so                 sr               am            ku              si
    ("Back",           "Артқа",         "Orqaga",       "Орқага",       "Dib u noqo",      "Nazad",         "ተመለስ",       "گەڕانەوە",      "ආපසු"),
    ("Close",          "Жабу",          "Yopish",       "Ёпиш",         "Xidh",            "Zatvori",       "ዝጋ",          "داخستن",       "වසන්න"),
    ("Main Menu",      "Басты мәзір",   "Bosh menyu",   "Бош меню",     "Liiska Weyn",     "Glavni meni",   "ዋና ማውጫ",     "لیستی سەرەکی",  "ප්‍රධාන මෙනුව"),
    ("Main menu",      "Басты мәзір",   "Bosh menyu",   "Бош меню",     "Liiska Weyn",     "Glavni meni",   "ዋና ማውጫ",     "لیستی سەرەکی",  "ප්‍රධාන මෙනුව"),
    ("More",           "Тағы",          "Yana",         "Яна",          "Dheeraad",        "Još",           "ተጨማሪ",      "زیاتر",        "තව"),
    ("Next",           "Келесі",        "Keyingi",      "Кейинги",      "Xiga",            "Sledeće",       "ቀጣይ",        "دواتر",        "ඊළඟ"),
    ("Previous",       "Алдыңғы",       "Oldingi",      "Олдинги",      "Hore",            "Prethodno",     "ቀዳሚ",        "پێشوو",        "කලින්"),
    ("Cancel",         "Болдырмау",     "Bekor qilish", "Бекор қилиш",  "Jooji",           "Otkaži",        "ሰርዝ",        "هەڵوەشاندنەوە", "අවලංගු"),
    ("Confirm",        "Растау",        "Tasdiqlash",   "Тасдиқлаш",    "Xaqiiji",         "Potvrdi",       "አረጋግጥ",      "پشتڕاستکردنەوە", "තහවුරු කරන්න"),
    ("Save",           "Сақтау",        "Saqlash",      "Сақлаш",       "Kaydi",           "Sačuvaj",       "አስቀምጥ",      "پاشەکەوتکردن",  "සුරකින්න"),
    ("Done",           "Дайын",         "Tayyor",       "Тайёр",        "Waa la sameeyay", "Gotovo",        "ተጠናቋል",      "تەواو",        "අවසන්"),
    ("Yes",            "Иә",            "Ha",           "Ҳа",           "Haa",             "Da",            "አዎ",          "بەڵێ",         "ඔව්"),
    ("No",             "Жоқ",           "Yo'q",         "Йўқ",          "Maya",            "Ne",            "አይ",          "نەخێر",        "නැහැ"),
    ("On",             "Қосулы",        "Yoqilgan",     "Ёқилган",      "Shid",            "Uključeno",     "በርቷል",       "چالاک",        "සක්‍රීය"),
    ("Off",            "Өшірулі",       "O'chirilgan",  "Ўчирилган",    "Dami",            "Isključeno",    "ጠፍቷል",       "ناچالاک",      "අක්‍රීය"),
    ("Delete",         "Жою",           "O'chirish",    "Ўчириш",       "Tirtir",          "Obriši",        "ሰርዝ",        "سڕینەوە",      "මකන්න"),
    ("Edit",           "Өңдеу",         "Tahrirlash",   "Таҳрирлаш",    "Wax ka beddel",   "Izmeni",        "አርትዕ",       "دەستکاری",     "සංස්කරණය"),
    ("Preview",        "Алдын ала көру", "Ko'rib chiqish", "Кўриб чиқиш", "Hordhac",        "Pregled",       "ቅድመ እይታ",    "پێشبینین",     "පෙරදසුන"),
    ("Settings",       "Баптаулар",     "Sozlamalar",   "Созламалар",   "Dejinta",         "Podešavanja",   "ቅንብሮች",      "ڕێکخستنەکان",   "සැකසුම්"),
    ("Language",       "Тіл",           "Til",          "Тил",          "Luqad",           "Jezik",         "ቋንቋ",        "زمان",         "භාෂාව"),
    ("Guide",          "Нұсқаулық",     "Qo'llanma",    "Қўлланма",     "Hage",            "Vodič",         "መመሪያ",       "ڕێبەر",        "මාර්ගෝපදේශය"),
    ("Support",        "Қолдау",        "Yordam",       "Ёрдам",        "Taageero",        "Podrška",       "ድጋፍ",        "پشتگیری",      "සහාය"),
    ("My Profile",     "Менің профилім", "Profilim",    "Профилим",     "Boggayga",        "Moj profil",    "መገለጫዬ",      "پرۆفایلەکەم",   "මගේ පැතිකඩ"),
    ("My Communities", "Менің қауымдастықтарым", "Hamjamiyatlarim", "Ҳамжамиятларим", "Bulshooyinkayga", "Moje zajednice", "ማህበረሰቦቼ", "کۆمەڵگاکانم", "මගේ ප්‍රජාවන්"),
    ("Communities",    "Қауымдастықтар", "Hamjamiyatlar", "Ҳамжамиятлар", "Bulshooyin",      "Zajednice",     "ማህበረሰቦች",   "کۆمەڵگاکان",   "ප්‍රජාවන්"),
    ("My Bots",        "Менің боттарым", "Botlarim",    "Ботларим",     "Bot-yadayda",     "Moji botovi",   "ቦቶቼ",        "بۆتەکانم",     "මගේ බොට්"),
    ("Admin",          "Әкімші",        "Admin",        "Админ",        "Maamule",         "Admin",         "አስተዳዳሪ",     "بەڕێوەبەر",    "පරිපාලක"),
    ("Start Studio",   "Start студиясы", "Start studiyasi", "Start студияси", "Istuudiyaha Start", "Start studio", "ስታርት ስቱዲዮ", "ستۆدیۆی Start", "Start චිත්‍රාගාරය"),
    ("Add Me to a Group", "Мені топқа қосу", "Meni guruhga qo'shing", "Мени гуруҳга қўшинг", "I ku dar koox", "Dodaj me u grupu", "ወደ ቡድን ጨምረኝ", "من زیاد بکە بۆ گروپ", "මාව කණ්ඩායමකට එක් කරන්න"),
    ("Add Me",         "Мені қосу",     "Meni qo'shing", "Мени қўшинг",  "I ku dar",        "Dodaj me",      "ጨምረኝ",       "زیادم بکە",    "මාව එක් කරන්න"),
    ("Email Us",       "Бізге жазыңыз", "Bizga yozing", "Бизга ёзинг",  "Nala soo xiriir", "Pišite nam",    "ኢሜይል ላኩልን",  "ئیمەیڵمان بۆ بنێرە", "අපට ඊමේල් කරන්න"),
    ("Telegram Chat",  "Telegram чаты", "Telegram chat", "Telegram чат", "Wada hadal Telegram", "Telegram čet", "የቴሌግራም ውይይት", "چاتی تێلێگرام", "ටෙලිග්‍රාම් චැට්"),
    ("Engganyo.com Support", "Engganyo.com қолдауы", "Engganyo.com yordami", "Engganyo.com ёрдами", "Taageerada Engganyo.com", "Engganyo.com podrška", "Engganyo.com ድጋፍ", "پشتگیری Engganyo.com", "Engganyo.com සහාය"),
    ("Group Settings", "Топ баптаулары", "Guruh sozlamalari", "Гуруҳ созламалари", "Dejinta Kooxda", "Podešavanja grupe", "የቡድን ቅንብሮች", "ڕێکخستنی گروپ", "කණ්ඩායම් සැකසුම්"),
    ("Channel Panel",  "Арна панелі",   "Kanal paneli", "Канал панели", "Guddiga Kanaalka", "Panel kanala", "የቻናል ፓነል",   "پانێلی کەناڵ", "නාලිකා පුවරුව"),
    ("Rules",          "Ережелер",      "Qoidalar",     "Қоидалар",     "Xeerarka",        "Pravila",       "ደንቦች",       "یاساکان",      "නීති"),
    ("Welcome",        "Қош келдіңіз",  "Xush kelibsiz", "Хуш келибсиз", "Soo dhawow",      "Dobrodošlica",  "እንኳን ደህና መጡ", "بەخێربێن",     "සාදරයෙන් පිළිගනිමු"),
    ("Goodbye",        "Қош болыңыз",   "Xayr",         "Хайр",         "Nabadgelyo",      "Doviđenja",     "ደህና ሁኑ",      "خواحافیز",     "ආයුබෝවන්"),
    ("Getting started", "Бастау",       "Boshlash",     "Бошлаш",       "Bilaabidda",      "Početak",       "መጀመር",       "دەستپێکردن",   "ආරම්භ කිරීම"),
    ("Everyone",       "Барлығы",       "Hamma",        "Ҳамма",        "Qof walba",       "Svi",           "ሁሉም",        "هەموو",        "සියලුම දෙනා"),
    ("Nobody",         "Ешкім",         "Hech kim",     "Ҳеч ким",      "Qofna",           "Niko",          "ማንም",        "هیچ کەس",      "කිසිවෙක් නැත"),
]
_TEXTS = [
    ("👇 Main menu",       "👇 Басты мәзір", "👇 Bosh menyu", "👇 Бош меню", "👇 Liiska weyn", "👇 Glavni meni", "👇 ዋና ማውጫ", "👇 لیستی سەرەکی", "👇 ප්‍රධාන මෙනුව"),
    ("Pick an option…",    "Таңдаңыз…", "Tanlang…", "Танланг…", "Dooro mid…", "Izaberite…", "ይምረጡ…", "هەڵبژێرە…", "තෝරන්න…"),
    ("Type your answer…",  "Жауабыңызды жазыңыз…", "Javobingizni yozing…", "Жавобингизни ёзинг…", "Qor jawaabtaada…", "Upišite odgovor…", "መልስዎን ይጻፉ…", "وەڵامەکەت بنووسە…", "ඔබේ පිළිතුර ලියන්න…"),
]
CORE: dict[str, dict[str, str]] = {lg: {r[0]: r[i + 1] for r in _ROWS} for i, lg in enumerate(ORDER)}
TEXTS: dict[str, dict[str, str]] = {lg: {r[0]: r[i + 1] for r in _TEXTS} for i, lg in enumerate(ORDER)}
