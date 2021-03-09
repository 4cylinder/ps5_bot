var pageid;
var culture;
var msgStart;
var msgEnd;

queueViewModel.pageReady(function (data) {

    pageid = $('body').attr('data-pageid');
    culture = $('body').attr('data-culture');

    repositionLanguageSelector();

    if (culture.substring(0, 2) === 'en') {
        msgStart = "^englishStart^";
        msgEnd = "^englishEnd^";
    } else if (culture.substring(0, 2) === 'fr') {
        msgStart = "^frenchStart^";
        msgEnd = "^frenchEnd^";
        document.title = "Vous \u00EAtes maintenant dans la file | Best Buy Canada";
    }
    
    if (pageid === "before" || pageid === "queue") {
        if (typeof queueViewModel.options.inqueueInfo !== 'undefined') {
            if (queueViewModel.options.inqueueInfo.message !== null) {
                $("#MainPart_pMessageOnQueueTicket").html(updateDynamicMessage($("#MainPart_pMessageOnQueueTicket").html()));
            }
        }
    }

    if (culture === 'en-US') {
        if (pageid === 'before') {}

        if (pageid === 'queue') {
            $("#middlepanel").show();
            addProgressbarText();

            $("#h2ConfirmRedirect").text("It's now your turn to shop.");
            $("#pConfirmRedirect").html("You have 10 minutes from the time shown above to start shopping.  <br><br> <b>Note:</b> If you don't enter the store during this time, your spot will be given to the next person who's waiting.");
            $("#buttonConfirmRedirect .l").text("Start Shopping");
        }

        if (pageid === 'exit' || pageid === 'error') {
            $('#MainPart_divWarningBox .l').text("Start Over");
        }

        // $('#middlepanel_iframe').css({ height: '205px' });
    }

    if (culture === 'fr-CA') {
        addEventName(" Vendredi Fou", "Solde");

        if (pageid === 'before') {}

        if (pageid === 'queue') {
            $("#middlepanel").show();
            addProgressbarText();

            $("#h2ConfirmRedirect").text("Vous avez atteint la tête de file.");    
            $("#pConfirmRedirect").text("Vous aurez 10 minutes \u00E0 partir de l\u2019heure indiqu\u00E9e ci-dessus pour entrer dans le magasin.\n\n Remarque: Si vous ne commencez pas à magasiner au cours de ces 10 minutes, votre place sera donnée à la personne suivante.");
            $("#buttonConfirmRedirect .l").text("Allons-y!");
        }

        if (pageid === 'exit' || pageid === 'error') {
            $('#MainPart_divWarningBox .l').text("Retourner dans la file");
        }

        // $('#middlepanel_iframe').css({ height: '228px' });
    }

});

queueViewModel.modelUpdated(function (data) {
    if (pageid === "before" || pageid === "queue") {
        if (data.message !== null) {
            data.message.text = updateDynamicMessage(data.message.text);
        }
    }
});

function updateDynamicMessage(queueMessageText){
    if(queueMessageText.indexOf(msgStart) === -1 || queueMessageText.indexOf(msgEnd) === -1){
        return queueMessageText;
    }
    return queueMessageText.substring(queueMessageText.lastIndexOf(msgStart) + msgStart.length, queueMessageText.lastIndexOf(msgEnd));  
}

function addEventName(eventName1, eventName2) {
    var div = document.createElement("div");
    var span1 = document.createElement("span");
    var span2 = document.createElement("span");

    div.id = "header-event-name";
    span1.id = "header-event-name-span1";
    span2.id = "header-event-name-span2";

    if (culture === 'fr-CA') {
        span1.textContent = eventName1;
        span2.textContent = eventName2;

        div.appendChild(span2);
        div.appendChild(span1);
    } else {
        span1.textContent = eventName1;
        span2.textContent = eventName2;

        div.appendChild(span1);
        div.appendChild(span2);
    }

    $("div#header h1.logo").append(div);
}

function addProgressbarText() {
    var div = document.createElement("div");
    var span = document.createElement("span");

    span.className = "progressbar-text-span";

    if (culture === 'fr-CA') {
        span.textContent = "Votre progression";
    } else {
        span.textContent = "Your progress";
    }

    div.id = "progressbar-text-div";
    div.appendChild(span);

    var referenceNode = document.getElementById("MainPart_divProgressbar");
    referenceNode.parentNode.insertBefore(div, referenceNode);
}

function repositionLanguageSelector() {
    try {
        var selector = document.getElementById("language-selector");
        var newParent = document.getElementById("footer");

        newParent.appendChild(selector);
    } catch (err) {}
}