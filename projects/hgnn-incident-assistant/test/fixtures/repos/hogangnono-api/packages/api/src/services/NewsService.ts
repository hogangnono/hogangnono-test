export class NewsService {
  constructor(newsRepository) {
    this.newsRepository = newsRepository;
  }

  getNewsList() {
    return this.newsRepository.findNewsBeforePublishedAt();
  }
}
