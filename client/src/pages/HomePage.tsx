import { Hero } from '../features/home/Hero.tsx';
import { FeaturedCarousel } from '../features/home/FeaturedCarousel.tsx';

export function HomePage() {
  return (
    <>
      <Hero />
      <FeaturedCarousel />
    </>
  );
}
