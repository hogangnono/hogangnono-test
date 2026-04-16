export class NewsController {
  constructor(newsService) {
    this.newsService = newsService;
  }

  @Get("/news")
  getNews() {
    return this.newsService.getNewsList();
  }
}
