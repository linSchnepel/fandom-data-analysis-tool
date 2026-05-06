# fandom-data-analysis-tool
Tool for data research concerning the online fandom archive AO3

This repository contains a web scraper designed for a research-oriented collection of publicly available AO3 metadata. To help protect creator rights, the public version of this project excludes scraped text content and other identifying details.

The goal of this tool is to support analysis of fandom trends.

###### Examples of best use cases
- [[Fandom stats] F/F, F/M, & M/M on AO3 -- How do fanworks vary by ship category?](https://archiveofourown.org/works/44610460/chapters/112221892) by toastystats (destinationtoast)
- [AO3 Year In Review: 2025](https://archiveofourown.org/works/77097891) by centreoftheselights
- [Fandom Trends in Clair Obscur](https://archiveofourown.org/works/75990861) by Zarathustare
- [Femslash February's Impact on AO3's Sapphic Works](https://archiveofourown.org/works/46695715/chapters/117604561) by Cookies_and_Chaos

## Background

Archive of Our Own (AO3) is a nonprofit archive of fanworks. Many works are text-based, though some may include images or audio.

At present, this program collects metadata such as tags, fandoms, timestamps, and other numerical fields. From this data, it can be used to study trends in work popularity, fandom activity, and genre correlation.

## How to use

This project is a simple Node.js script that outputs data in JSONL format.

Scraping begins from acquiring a partial URL of page listings for a selected fandom and processing the given HTML. Some works are restricted and may only be accessible to logged-in users. Initial Listing data may be cleaned, which can then be used to collect related Kudos, Comments, Bookmarks, and Histories data.

The script uses a single-threaded workflow: load a page, extract data, wait, then move to the next page. This is intentional and helps reduce load on AO3 by keeping requests slow and predictable. AO3 states that it uses technical measures such as rate limiting to hinder large-scale scraping, so this project is designed for small, research-focused datasets rather than high-volume collection.

### Variables required

```txt
AO3_URL=[https://archiveofourown.org/works?work_search...&page=]
LOG_IN_TRUE=false
LOGIN_USERNAME=[optional]
LOGIN_PASSWORD=[optional]
```

## Associated Works
The output data from this project is used for the visual [AoAnalysis](https://github.com/linSchnepel/AoAnalysis)
