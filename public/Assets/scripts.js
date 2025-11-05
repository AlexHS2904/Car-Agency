document.addEventListener("DOMContentLoaded", () => {
  const wrapper = document.getElementById("miniCarouselWrapper");
  const track = document.getElementById("miniCarouselTrack");
  const prevBtn = document.getElementById("miniCarouselPrev");
  const nextBtn = document.getElementById("miniCarouselNext");

  if (!wrapper || !track) return;

  const getStep = () => {
    const firstCard = track.querySelector(".mini-carousel-card");
    if (!firstCard) return 200;
    const width = firstCard.offsetWidth;
    const margin = parseFloat(window.getComputedStyle(firstCard).marginRight);
    const step = width + margin;
    return step * 3;
  };

  nextBtn.addEventListener("click", () => {
    wrapper.scrollBy({ left: getStep(), behavior: "smooth" });
  });

  prevBtn.addEventListener("click", () => {
    wrapper.scrollBy({ left: -getStep(), behavior: "smooth" });
  });
});
