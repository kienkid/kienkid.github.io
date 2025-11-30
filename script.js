
// Wait for the HTML document to be fully loaded before running the script
document.addEventListener('DOMContentLoaded', () => {

    // 1. Select all navigation links and the "Call to Action" button in the hero
    // We look for any <a> tag that has an href starting with "#"
    const navLinks = document.querySelectorAll('a[href^="#"]');

    // 2. Loop through each link and add a click event listener
    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            // Prevent the default jump behavior
            e.preventDefault();

            // Get the target section ID (e.g., "#about") from the href attribute
            const targetId = this.getAttribute('href');
            const targetSection = document.querySelector(targetId);

            if (targetSection) {
                // 3. Calculate the scroll position
                
                // Get the height of your fixed header so we can subtract it
                const headerHeight = document.querySelector('header').offsetHeight;
                
                // Calculate exactly where the element is on the page relative to the top
                const elementPosition = targetSection.getBoundingClientRect().top;
                
                // Determine the final scroll position:
                // Current scroll + Element relative position - Header height - Extra padding (20px)
                const offsetPosition = elementPosition + window.scrollY - headerHeight - 20;

                // 4. Execute the smooth scroll
                window.scrollTo({
                    top: offsetPosition,
                    behavior: "smooth"
                });
            }
        });
    });

    // 5. Highlight active link on scroll
    const sections = document.querySelectorAll('section');
    const navLi = document.querySelectorAll('nav ul li a');

    window.addEventListener('scroll', () => {
        let current = '';
        
        sections.forEach(section => {
            const sectionTop = section.offsetTop;
            const sectionHeight = section.clientHeight;
            // If we have scrolled past the top of this section (minus a little offset)
            if (scrollY >= (sectionTop - 150)) {
                current = section.getAttribute('id');
            }
        });

        navLi.forEach(a => {
            a.classList.remove('active');
            if (a.getAttribute('href').includes(current)) {
                a.classList.add('active');
            }
        });
    });
    // 6. Contact Form Handling
    const contactForm = document.getElementById('contact-form');
    const feedbackMsg = document.getElementById('form-feedback');

    if (contactForm) {
        contactForm.addEventListener('submit', function(e) {
            e.preventDefault(); // STOP the page from refreshing

            // Here you would typically send data to a server.
            // For now, we simulate a delay to make it feel real.
            
            // Change button text to show processing
            const btn = contactForm.querySelector('button');
            const originalText = btn.innerText;
            btn.innerText = 'Sending...';

            setTimeout(() => {
                // Reset the form (clear inputs)
                contactForm.reset();
                
                // Show success message
                feedbackMsg.style.display = 'block';
                
                // Restore button text
                btn.innerText = originalText;

                // Hide the success message after 10 seconds
                setTimeout(() => {
                    feedbackMsg.style.display = 'none';
                }, 10000);

            }, 1000); // Wait 1 seconds to simulate network request
        });
    }
    // 7. Mobile Navigation Toggle
    const hamburger = document.getElementById('hamburger');
    const navLinksContainer = document.getElementById('nav-links');

    if (hamburger) {
        hamburger.addEventListener('click', () => {
            // Toggle the .active class on the hamburger (for the X animation)
            hamburger.classList.toggle('active');
            // Toggle the .active class on the list (to slide it in/out)
            navLinksContainer.classList.toggle('active');
        });
    }

    // 8. Close mobile menu when a link is clicked
    const navItems = document.querySelectorAll('nav ul li a');
    
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            // If the menu is open, close it
            if (hamburger.classList.contains('active')) {
                hamburger.classList.remove('active');
                navLinksContainer.classList.remove('active');
            }
        });
    });

    
});



function changeVideo(videoId) {
    const mainVideo = document.getElementById("main-video");
    mainVideo.src = "https://www.youtube.com/embed/" + videoId;
}